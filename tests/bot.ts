import { CONFIG } from '../src/config';
import { TAU } from '../src/core/math';
import { applyUpgrade } from '../src/systems/progression';
import { takeSpoil } from '../src/systems/chests';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import type { Chest, Player } from '../src/world/types';

const DT = 1 / CONFIG.tickRate;

/** Enemies closer than this push the bot away; the push grows as they close in. */
const DANGER_RADIUS = 190;
/** Gems further than this are not worth walking to. */
const GEM_RADIUS = 340;
/** Radians per second the idle wander direction drifts. */
const WANDER_TURN = 0.35;
/** Ticks between gem searches. Gems are not in the grid, so this stays linear. */
const GEM_INTERVAL = 6;

/**
 * Enemies on the field above which the bot calls the situation a crowd.
 *
 * Only used to choose a spoil. Roughly where the horde stops being something
 * to walk around — the stand measures a few hundred bodies by the eighth
 * minute — so a sweep below it would be spent clearing thin air.
 */
const CROWDED = 150;

/** Health below which the bot would rather be patched up than anything else. */
const HURT = 0.6;

/**
 * Seconds the bot will keep walking at one chest before writing it off.
 *
 * It has no patience of its own and would otherwise pursue forever, which is
 * not a player: chests are placed behind, the flee vector points away from the
 * crowd and therefore roughly forward, so a bot under steady pressure can be
 * pulled at a chest it never closes on. Measured on seed 42, on the base
 * before the spear and the harpoon — a chest out for 48% of the run, two
 * collected in twelve minutes, and 537 kills at level 10 against the 10440 at
 * level 29 the same seed used to produce. It was not playing the game any
 * more, it was commuting.
 *
 * Five seconds is the unobstructed walk. Twenty-five is "I tried".
 */
const CHEST_PATIENCE = 25;

/** How far ahead the bot looks for a hex that is going to hit it, in seconds. */
const DODGE_HORIZON = 1.1;
/** How much a sidestep outweighs everything else when a hex is about to land. */
const DODGE_WEIGHT = 2.5;

/**
 * The bot's own broad-phase buffer.
 *
 * Deliberately not `world.scratch`: that one belongs to the systems, and
 * borrowing it from outside the tick is exactly the aliasing bug it would be
 * hardest to notice.
 */
const candidates: number[] = [];

/**
 * Upgrade preference, best first.
 *
 * A bot that takes whatever is offered first measures luck, not balance. A
 * fixed priority makes every run build the same way, so a change in survival
 * time can only come from the change being measured.
 */
const PREFERENCE = [
  'nova',
  'orbit',
  'spear',
  'harpoon',
  'ember',
  'damage',
  'haste',
  // Rate before reach, and both before the remaining stats: a weapon-specific
  // multiplier pays out on one weapon but pays more, and the bot leans on nova
  // and the blades for its kills. Leaving these at the bottom of the list, as
  // they were when they had no rate line to compete with, measured a player who
  // never takes them while they still crowd every roll — the worst reading of
  // the pool rather than the honest one. The spear's two lines sit beside
  // their opposite numbers for the same reason: a weapon the bot is offered and
  // never takes is a weapon this stand cannot measure, only pay for.
  'nova-cadence',
  'orbit-spin',
  'spear-cadence',
  'harpoon-winch',
  'ember-heat',
  'multishot',
  'nova-blast',
  'orbit-reach',
  'spear-haft',
  'ember-spread',
  'vitality',
  'pierce',
  'magnet',
  'boots',
];

/**
 * A player good enough to balance against.
 *
 * Steering is a potential field: every nearby enemy pushes, the nearest gem
 * pulls, and the two are blended by how much pressure the bot is under. It is
 * not a good player — it cannot plan, and it will happily reverse into a second
 * crowd — but it kites, which is the one skill the genre actually requires, and
 * it is deterministic, so two runs of the same seed are the same run.
 *
 * It opens with the bolt, which is what `new World(seed)` grants. The opening
 * choice is therefore the one thing in the game no stand here weighs; see the
 * README for what a one-off probe measured about it.
 */
export function runBot(seed: number, seconds: number, watch?: (world: World) => void): World {
  return play(new World(seed), seconds, watch);
}

/**
 * The same bot, one per player, in one world.
 *
 * Each of them steers by its own potential field — its own crowd pushes it, its
 * own nearest gem pulls it, its own wander carries it when nothing else does —
 * so a party is genuinely several players rather than one player drawn four
 * times. What they share is what the game shares: the horde, the chest, and the
 * experience bar.
 *
 * They do not cooperate, and that is on purpose. A stand that measured four
 * bots executing a plan would be measuring the plan. This measures what the
 * rules do to four people playing the only way this game asks anybody to play.
 */
export function runParty(
  seed: number,
  seconds: number,
  starters: readonly string[],
  watch?: (world: World) => void,
): World {
  return play(new World(seed, starters), seconds, watch);
}

function play(world: World, seconds: number, watch?: (world: World) => void): World {
  const ticks = Math.round(seconds * CONFIG.tickRate);
  const count = world.players.length;

  // Per player, because every one of them is steering separately. A shared
  // wander would march the whole party in step, which is one player again.
  const wander = world.players.map((_, index) => (index * TAU) / count);
  const gemX = new Array<number>(count).fill(0);
  const gemY = new Array<number>(count).fill(0);

  /** The chest currently being walked at, by identity, and when to give up. */
  let pursued: Chest | null = null;
  let patienceEndsAt = 0;

  for (let i = 0; i < ticks; i++) {
    if (world.phase === 'dead') break;

    // Both menus belong to somebody in particular, and `choosing` says who.
    if (world.phase === 'levelup') {
      const player = world.players[world.choosing];
      applyUpgrade(world, player, choose(player));
      continue;
    }

    if (world.phase === 'chest') {
      const player = world.players[world.choosing];
      takeSpoil(world, player, chooseSpoil(world, player));
      continue;
    }

    // A new chest is a new decision, so the clock restarts with it. Compared
    // by identity because every placement is a fresh object and nothing ever
    // moves one. One clock for the party: the chest is one errand, and whoever
    // gets there first spends it.
    if (world.chest !== pursued) {
      pursued = world.chest;
      patienceEndsAt = world.time + CHEST_PATIENCE;
    }

    const pursuing = world.time < patienceEndsAt;

    for (let p = 0; p < count; p++) {
      const player = world.players[p];
      if (player.hp <= 0) continue;

      if (i % GEM_INTERVAL === 0) {
        const shopping = shoppingDirection(world, player, pursuing);
        gemX[p] = shopping.x;
        gemY[p] = shopping.y;
      }

      wander[p] += WANDER_TURN * DT;
      steer(world, player, wander[p], gemX[p], gemY[p]);
    }

    stepWorld(world, DT);
    watch?.(world);
  }

  return world;
}

function choose(player: Player): string {
  for (const id of PREFERENCE) {
    if (player.offered.some((offer) => offer.id === id)) return id;
  }
  return player.offered[0].id;
}

/**
 * Which spoil the bot takes.
 *
 * A fixed preference the way `PREFERENCE` is fixed would measure a player who
 * heals at full health, and the stand would then be reading a card that does
 * nothing rather than the card the game offers. Two conditions is enough to be
 * a reasonable player and still be entirely deterministic: patch up when hurt,
 * sweep when buried, otherwise take the gems.
 */
function chooseSpoil(world: World, player: Player): string {
  const offered = (id: string): boolean => world.spoils.some((spoil) => spoil.id === id);

  if (player.hp < player.stats.maxHp * HURT && offered('mend')) return 'mend';
  if (world.enemies.length >= CROWDED && offered('purge')) return 'purge';
  return world.spoils[0].id;
}

/**
 * Where the bot goes when it is not being chased.
 *
 * A chest outranks every gem on the field and is worth walking past them for:
 * it is the only thing in the world that has to be fetched, and a bot that
 * ignored it would measure a player leaving free power on the ground. But only
 * while it is still worth chasing — see `CHEST_PATIENCE`. A bot that never
 * gives up stops collecting anything at all, which is a different wrong answer
 * and a worse one, because it looks like the game got harder.
 */
function shoppingDirection(
  world: World,
  player: Player,
  pursuing: boolean,
): { x: number; y: number } {
  const chest = world.chest;
  if (chest === null || !pursuing) return nearestGemDirection(world, player);

  const dx = chest.x - player.x;
  const dy = chest.y - player.y;
  const distance = Math.hypot(dx, dy) || 1;
  return { x: dx / distance, y: dy / distance };
}

function steer(
  world: World,
  player: Player,
  wander: number,
  pullX: number,
  pullY: number,
): void {
  let pushX = 0;
  let pushY = 0;

  // The grid was rebuilt during the previous tick and nothing has been removed
  // since — reap runs at the top of the next one — so these indices are live.
  const enemies = world.enemies;
  world.grid.query(player.x, player.y, DANGER_RADIUS, candidates);

  for (let c = 0; c < candidates.length; c++) {
    const enemy = enemies[candidates[c]];
    if (enemy === undefined || enemy.hp <= 0) continue;

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= DANGER_RADIUS * DANGER_RADIUS || distanceSq === 0) continue;

    const distance = Math.sqrt(distanceSq);
    // Quadratic falloff: one enemy at arm's length matters more than five at
    // the edge of the danger circle.
    const weight = (1 - distance / DANGER_RADIUS) ** 2;
    pushX += (dx / distance) * weight;
    pushY += (dy / distance) * weight;
  }

  const pressure = Math.hypot(pushX, pushY);
  if (pressure > 0) {
    pushX /= pressure;
    pushY /= pressure;
  }

  // Under real pressure the bot only runs; when it is clear, it goes shopping.
  const flee = Math.min(1, pressure);
  let x = pushX * flee + pullX * (1 - flee);
  let y = pushY * flee + pullY * (1 - flee);

  // A hex is aimed where the bot is going, so the counter is to stop going
  // there. Without this the stand measures a player who never uses the only
  // defence the mechanic has — the same mistake the upgrade priorities made,
  // and the reason the balance table is worth anything at all.
  //
  // The loop is empty whenever nothing hostile is in the air, and every run
  // that never meets a caster therefore steers exactly as it did before this
  // existed. That is what keeps the older tables comparable.
  const projectiles = world.projectiles;
  for (let i = 0; i < projectiles.length; i++) {
    const hex = projectiles[i];
    if (!hex.hostile) continue;

    const toX = player.x - hex.x;
    const toY = player.y - hex.y;
    const speedSq = hex.vx * hex.vx + hex.vy * hex.vy;
    if (speedSq === 0) continue;

    // Time at which the hex is closest to where the bot stands now. Negative
    // means it is already past and no longer anyone's problem.
    const closest = (toX * hex.vx + toY * hex.vy) / speedSq;
    if (closest <= 0 || closest > DODGE_HORIZON) continue;

    const missX = toX - hex.vx * closest;
    const missY = toY - hex.vy * closest;
    const miss = Math.hypot(missX, missY);
    // Twice the hit radius: a shot that is merely close still deserves a step,
    // because the bot is moving and the margin is what the lead is aiming at.
    const threat = (hex.radius + CONFIG.player.radius) * 2;
    if (miss >= threat) continue;

    // Sideways, on the side the bot is already on, so the step is the short
    // one. Sooner is more urgent, and a shot dead on line gets the full push.
    const urgency = (1 - closest / DODGE_HORIZON) * (1 - miss / threat);
    const side = missX * -hex.vy + missY * hex.vx >= 0 ? 1 : -1;
    const speed = Math.sqrt(speedSq);
    x += ((-hex.vy / speed) * side) * DODGE_WEIGHT * urgency;
    y += ((hex.vx / speed) * side) * DODGE_WEIGHT * urgency;
  }

  if (Math.hypot(x, y) < 0.05) {
    x = Math.cos(wander);
    y = Math.sin(wander);
  }

  const length = Math.hypot(x, y);
  player.intentX = x / length;
  player.intentY = y / length;
}

function nearestGemDirection(world: World, player: Player): { x: number; y: number } {
  const gems = world.gems;

  let bestSq = GEM_RADIUS * GEM_RADIUS;
  let x = 0;
  let y = 0;

  for (let i = 0; i < gems.length; i++) {
    const dx = gems[i].x - player.x;
    const dy = gems[i].y - player.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= bestSq) continue;

    bestSq = distanceSq;
    const distance = Math.sqrt(distanceSq) || 1;
    x = dx / distance;
    y = dy / distance;
  }

  return { x, y };
}
