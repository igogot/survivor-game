import { spawnProjectile } from './projectiles';
import { enemyById } from '../data/enemies';
import { nearestPlayer } from '../world/party';
import type { Enemy } from '../world/types';
import type { World } from '../world/world';

/**
 * The horde's own attacks — everything it does that is not walking into the
 * player.
 *
 * Runs in the combat half of the tick, after the grid is rebuilt, and adds
 * projectiles rather than enemies, so no broad-phase index is disturbed.
 */
export function enemyAttackSystem(world: World, dt: number): void {
  const enemies = world.enemies;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    // Cheap gate: `standoff` is non-zero only on the types that can do this, so
    // the horde's ordinary members cost one comparison each.
    if (enemy.standoff <= 0 || enemy.hp <= 0) continue;

    enemy.attackCooldown -= dt;
    if (enemy.attackCooldown > 0) continue;

    const def = enemyById(enemy.defId);
    if (def?.ranged === undefined) continue;

    enemy.attackCooldown = def.ranged.cooldown;
    throwHex(world, enemy, def.ranged);
  }
}

type RangedDef = NonNullable<import('../data/enemies').EnemyDef['ranged']>;

/**
 * Aims where its target is going, not where they are.
 *
 * A hex flies at 205 against a player who moves at up to 275, so a shot at the
 * player's current position misses every time they are moving — the enemy would
 * be decoration. Leading fixes that and buys the mechanic its counter for free:
 * the lead assumes the player holds their heading, so turning beats it and
 * running in a straight line does not.
 *
 * The target is the nearest player, and the lead reads *their* heading rather
 * than the party's. That matters with more than one: an average of four
 * headings points nowhere in particular, and a shot led along it would miss
 * everybody by design instead of by the player's own turn.
 *
 * The flight time is solved by iterating twice rather than with the quadratic.
 * Two passes land within a few pixels at these speeds, and the intent is a
 * plausible guess by something throwing a bottle, not a firing solution.
 */
function throwHex(world: World, enemy: Enemy, ranged: RangedDef): void {
  const player = nearestPlayer(world, enemy.x, enemy.y);
  if (player === null) return;

  const speed = player.stats.moveSpeed;

  let aimX = player.x;
  let aimY = player.y;

  for (let pass = 0; pass < 2; pass++) {
    const flight = Math.hypot(aimX - enemy.x, aimY - enemy.y) / ranged.projectileSpeed;
    aimX = player.x + player.headingX * speed * flight;
    aimY = player.y + player.headingY * speed * flight;
  }

  const dx = aimX - enemy.x;
  const dy = aimY - enemy.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return;

  const projectile = spawnProjectile(world);
  projectile.x = enemy.x;
  projectile.y = enemy.y;
  projectile.px = projectile.x;
  projectile.py = projectile.y;
  projectile.vx = (dx / distance) * ranged.projectileSpeed;
  projectile.vy = (dy / distance) * ranged.projectileSpeed;
  projectile.damage = ranged.damage;
  projectile.radius = ranged.projectileRadius;
  projectile.life = ranged.life;
  projectile.pierce = 0;
  projectile.lastHitId = 0;
  projectile.color = enemy.color;
  projectile.hostile = true;
  projectile.sprite = 'hex';
}
