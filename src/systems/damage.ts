import { CONFIG } from '../config';
import { bossAbilityById } from '../data/bossAbilities';
import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { anyAlive, nearestPlayer, nextLiving } from '../world/party';
import { respawnDelay } from './respawn';
import { dist2 } from '../core/math';
import { BROADPHASE_PAD } from './shared';
import type { Enemy, Player } from '../world/types';
import type { World } from '../world/world';

/**
 * The single place an enemy loses health.
 *
 * Kills are only *marked* here (hp <= 0); the reap system removes the body at
 * the top of the next tick, because every caller is mid-iteration over grid
 * indices that a removal would invalidate.
 */
/**
 * How long an enemy stays lit after being hit, in seconds.
 *
 * Exported because the renderer fades the flash over exactly this window; two
 * copies of the number would drift and the fade would end early or late.
 */
export const FLASH_TIME = 0.08;

export function applyDamage(world: World, enemy: Enemy, amount: number): void {
  if (enemy.hp <= 0) return;

  const landed = enemy.boss ? bossToll(world, enemy, amount) : amount;

  enemy.hp -= landed;
  enemy.flash = FLASH_TIME;
  if (enemy.hp <= 0) world.kills++;
}

/**
 * What a boss's own trick does to a hit on the way in.
 *
 * Two of the ten abilities are about damage arriving rather than about anything
 * the boss does with a cooldown, so they belong here and not in
 * `bossAbilitySystem`: a ward that lived in the ability system would have to
 * reach into this function anyway, and a reflection would have to guess how
 * much actually landed.
 *
 * Returns what should come off the boss, and may cost the player on the way.
 */
function bossToll(world: World, enemy: Enemy, amount: number): number {
  const ability = bossAbilityById(enemy.ability);
  if (ability === undefined) return amount;

  if (ability.id === 'ward') {
    // Only while the window is up. Outside it a warded boss is an ordinary one,
    // which is what makes the window worth waiting out.
    return enemy.abilityTimer > 0 ? amount * ability.power : amount;
  }

  if (ability.id === 'thorns') {
    const player = nearestPlayer(world, enemy.x, enemy.y);
    // Through `damagePlayer`, so a reflection obeys the same invulnerability
    // window as a body does — otherwise a fast weapon would return the whole
    // volley at once and kill through it.
    if (player !== null) damagePlayer(world, player, amount * ability.power);
  }

  return amount;
}

/**
 * The single place a player loses health.
 *
 * Three things reach them — a body touching them, a hex landing on them and a
 * bomber going off under them — and all three must agree on the invulnerability
 * window and on what happens at zero. The window is the game's damage governor:
 * it is why standing in a crowd of forty is survivable, and routing the horde's
 * projectiles through it rather than around it is what keeps that promise while
 * still letting them land when nothing is close enough to touch.
 *
 * The window is per player, which is the only thing it could sensibly be: it is
 * the grace *this* body was granted for the hit *it* took.
 *
 * A run ends when the last player falls, not the first. Anybody else going down
 * starts a countdown instead: they watch a teammate until it runs out and come
 * back beside them. See `respawnSystem` — the wait, the camera and where the
 * body reappears all live there.
 *
 * Returns whether the hit landed, so a caller can tell a blocked hit from one
 * that connected.
 */
export function damagePlayer(world: World, player: Player, amount: number): boolean {
  if (player.invuln > 0 || amount <= 0 || player.hp <= 0) return false;

  player.hp -= amount;
  player.invuln = CONFIG.player.invulnTime;

  if (player.hp <= 0) {
    player.hp = 0;

    if (anyAlive(world)) {
      // Somebody is left, so this is a wait rather than an ending. The camera
      // starts on whoever is nearest, which is almost always whoever they were
      // fighting beside — and it is a starting point, not a sentence: the left
      // mouse button moves it.
      player.respawnAt = world.time + respawnDelay(world);
      const nearest = nearestPlayer(world, player.x, player.y);
      player.watching =
        nearest === null ? nextLiving(world, 0) : world.players.indexOf(nearest);
    } else {
      world.phase = 'dead';
    }
  }

  return true;
}

/**
 * The single place the player gains health.
 *
 * Mirrors `damagePlayer` for the same reason it exists: overhealing has to be
 * clamped somewhere, and a second copy of that clamp is where the two would
 * disagree. Until chests arrived the only healing in the game was a max-HP
 * card paying back what it granted, and that clamp was written inline.
 *
 * Returns how much was actually restored, so a caller can tell a heal that
 * landed from one poured onto a full bar.
 */
export function healPlayer(player: Player, amount: number): number {
  // A dead player is not hurt, they are finished. Healing one would take the
  // run back out of an ending it has already reached.
  if (amount <= 0 || player.hp <= 0) return 0;

  const restored = Math.min(amount, player.stats.maxHp - player.hp);
  player.hp += restored;
  return restored;
}

/**
 * Damages every enemy overlapping a circle, at most once per damage event.
 *
 * `event` comes from `world.nextDamageEvent()` and is shared by every circle
 * belonging to the same attack: a ring of blades queries the grid once per
 * blade, and an enemy caught between two of them must still take one hit. The
 * stamp lives on the enemy, so the de-duplication costs one integer compare
 * instead of a per-pulse Set.
 *
 * Returns the number of enemies hit — handy for tests and for future
 * on-hit effects.
 */
/**
 * Damages every enemy within `radius` of a line, at most once per damage event.
 *
 * The lance the spear thrusts. A single circle cannot express it: the weapon's
 * whole point is that a queue of enemies standing one behind the other costs
 * one thrust, and a circle wide enough to hold that queue would also sweep up
 * everything to the sides of it.
 *
 * `dx`/`dy` must be a unit vector; `length` is measured from `x`,`y` along it.
 * The broad-phase is asked for one circle around the middle of the line, which
 * is cheaper than walking cells along it and, at the reaches this weapon has,
 * barely wider.
 *
 * Returns the number of enemies hit.
 */
export function damageSegment(
  world: World,
  x: number,
  y: number,
  dx: number,
  dy: number,
  length: number,
  radius: number,
  damage: number,
  event: number,
): number {
  const { grid, enemies, scratch } = world;

  const half = length / 2;
  const midX = x + dx * half;
  const midY = y + dy * half;
  grid.query(midX, midY, half + radius + MAX_ENEMY_RADIUS + BROADPHASE_PAD, scratch);

  let hits = 0;
  for (let i = 0; i < scratch.length; i++) {
    const enemy = enemies[scratch[i]];
    if (enemy === undefined || enemy.hp <= 0) continue;
    if (enemy.hitTag === event) continue;

    // Nearest point on the segment, which is the projection clamped to its ends
    // — an enemy past the tip is out of reach rather than infinitely in it.
    const travel = Math.min(Math.max((enemy.x - x) * dx + (enemy.y - y) * dy, 0), length);
    const reach = radius + enemy.radius;
    if (dist2(x + dx * travel, y + dy * travel, enemy.x, enemy.y) > reach * reach) continue;

    enemy.hitTag = event;
    applyDamage(world, enemy, damage);
    hits++;
  }

  return hits;
}

export function damageArea(
  world: World,
  x: number,
  y: number,
  radius: number,
  damage: number,
  event: number,
): number {
  const { grid, enemies, scratch } = world;
  grid.query(x, y, radius + MAX_ENEMY_RADIUS + BROADPHASE_PAD, scratch);

  let hits = 0;
  for (let i = 0; i < scratch.length; i++) {
    const enemy = enemies[scratch[i]];
    if (enemy === undefined || enemy.hp <= 0) continue;
    if (enemy.hitTag === event) continue;

    const reach = radius + enemy.radius;
    if (dist2(x, y, enemy.x, enemy.y) > reach * reach) continue;

    enemy.hitTag = event;
    applyDamage(world, enemy, damage);
    hits++;
  }

  return hits;
}
