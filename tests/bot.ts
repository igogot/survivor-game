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
  'damage',
  'haste',
  // Rate before reach, and both before the remaining stats: a weapon-specific
  // multiplier pays out on one weapon but pays more, and the bot leans on nova
  // and the blades for its kills. Leaving these at the bottom of the list, as
  // they were when they had no rate line to compete with, measured a player who
  // never takes them while they still crowd every roll — the worst reading of
  // the pool rather than the honest one.
  'nova-cadence',
  'orbit-spin',
  'multishot',
  'nova-blast',
  'orbit-reach',
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
 */
export function runBot(seed: number, seconds: number): World {
  const world = new World(seed);
  const ticks = Math.round(seconds * CONFIG.tickRate);

  let wander = 0;
  let gemX = 0;
  let gemY = 0;

  for (let i = 0; i < ticks; i++) {
    if (world.phase === 'dead') break;

    if (world.phase === 'levelup') {
      applyUpgrade(world, choose(world));
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
  }

  return world;
}

function choose(world: World): string {
  for (const id of PREFERENCE) {
    if (world.offered.some((offer) => offer.id === id)) return id;
  }
  return world.offered[0].id;
}

function steer(world: World, wander: number, pullX: number, pullY: number): void {
  const player = world.player;

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

  if (Math.hypot(x, y) < 0.05) {
    x = Math.cos(wander);
    y = Math.sin(wander);
  }

  const length = Math.hypot(x, y);
  world.intentX = x / length;
  world.intentY = y / length;
}

function nearestGemDirection(world: World): { x: number; y: number } {
  const player = world.player;
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
