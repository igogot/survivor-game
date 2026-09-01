import { CONFIG } from '../src/config';
import { applyUpgrade } from '../src/systems/progression';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';

const DT = 1 / CONFIG.tickRate;

/** Enemies closer than this push the bot away; the push grows as they close in. */
const DANGER_RADIUS = 190;
/** Gems further than this are not worth walking to. */
const GEM_RADIUS = 340;
/** Radians per second the idle wander direction drifts. */
const WANDER_TURN = 0.35;
/** Ticks between gem searches. Gems are not in the grid, so this stays linear. */
const GEM_INTERVAL = 6;

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
 * It always opens with the bolt, which is what `new World(seed)` grants. The
 * opening choice is therefore the one thing in the game no stand here weighs;
 * see the README for what a one-off probe measured about it.
 */
export function runBot(seed: number, seconds: number, watch?: (world: World) => void): World {
  const world = new World(seed);
  const ticks = Math.round(seconds * CONFIG.tickRate);

  let wander = 0;
  let gemX = 0;
  let gemY = 0;

  for (let i = 0; i < ticks; i++) {
    if (world.phase === 'dead') break;

    if (world.phase === 'levelup') {
      applyUpgrade(world, world.players[0], choose(world));
      continue;
    }

    if (i % GEM_INTERVAL === 0) {
      const gem = nearestGemDirection(world);
      gemX = gem.x;
      gemY = gem.y;
    }

    wander += WANDER_TURN * DT;
    steer(world, wander, gemX, gemY);
    stepWorld(world, DT);
    watch?.(world);
  }

  return world;
}

function choose(world: World): string {
  for (const id of PREFERENCE) {
    if (world.players[0].offered.some((offer) => offer.id === id)) return id;
  }
  return world.players[0].offered[0].id;
}

function steer(world: World, wander: number, pullX: number, pullY: number): void {
  const player = world.players[0];

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
  world.players[0].intentX = x / length;
  world.players[0].intentY = y / length;
}

function nearestGemDirection(world: World): { x: number; y: number } {
  const player = world.players[0];
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
