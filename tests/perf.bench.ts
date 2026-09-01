import { expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Pool } from '../src/core/pool';
import { applyUpgrade } from '../src/systems/progression';
import { rollEnemyDef, spawnEnemy } from '../src/systems/spawn';
import { SpatialGrid } from '../src/world/grid';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import type { Effect, Enemy, Gem, Projectile } from '../src/world/types';

/**
 * What the broad-phase and the pool are actually worth, in enemies.
 *
 * The README claims both are what keeps the frame rate up. This measures it:
 * the same world is stepped through three implementations that differ only in
 * how collisions are looked up and whether entities are recycled, and each is
 * pushed until a tick no longer fits its slice of a 60 fps frame.
 *
 * Run with `npm run perf`. It takes minutes, so it stays out of `npm test` —
 * the same arrangement the balance harness uses.
 */

const DT = 1 / CONFIG.tickRate;
const FRAME_MS = 1000 / CONFIG.tickRate;

/**
 * How much of a frame the simulation may take.
 *
 * Half. The other half belongs to Pixi, to the browser's own compositing and to
 * whatever else shares the main thread; a simulation that ate the whole frame
 * would leave nothing to draw with. Every number here is a simulation cost —
 * rendering is measured separately, in a browser.
 */
const SIM_BUDGET_MS = FRAME_MS / 2;

/**
 * "Stable" means the 99th percentile fits, not the average. A mean under budget
 * with one tick in twenty over it is a visible stutter, which is exactly the
 * failure the object pool exists to prevent.
 */
const PERCENTILE = 99;

/** Five minutes into a run: every enemy type unlocked, HP scaled accordingly. */
const RUN_TIME = 300;
const HP_SCALE = 1 + (RUN_TIME / 60) * CONFIG.spawn.hpScalePerMinute;

/**
 * A mid-run build carrying the whole roster, so every damage path in the game
 * is part of the measured tick: projectiles for the bolt and the harpoon, the
 * orbiting ring, the shockwave's circle, the lance's segment and the trail's
 * burning ground.
 *
 * The trail is the reason this list is worth keeping current. Every other
 * weapon costs a fixed number of broad-phase queries per activation; that one
 * costs one per patch of fire on the ground, and how many there are is decided
 * by how far the player has walked. It is the only weapon that could make a
 * tick more expensive without anything on screen changing.
 */
const BUILD = [
  'orbit',
  'orbit',
  'nova',
  'nova',
  'spear',
  'harpoon',
  'ember',
  'damage',
  'damage',
  'haste',
  'haste',
  'multishot',
  'pierce',
];

const SEED = 4242;
/** Long enough for the horde to converge on the player and for V8 to settle. */
const WARMUP_TICKS = 180;
const SAMPLE_TICKS = 360;

/**
 * How many times each measurement is repeated.
 *
 * A developer machine is never idle — a browser, an editor and a file-sync
 * daemon all want the same four cores — and every one of those steals time
 * *into* the measurement and never out of it. So the repeats are combined by
 * taking the lowest reading rather than the average: the cheapest run is the
 * one least contaminated by everything else on the machine. Averaging would
 * report the state of the desktop, not the cost of the code.
 */
const REPEATS = 5;

/**
 * The head count the game caps itself to, read before the bench switches the
 * spawner off. The ladder answers "how far could this go"; this answers the
 * more useful question of what a tick costs at the size actually shipped.
 */
const REFERENCE_COUNT = CONFIG.spawn.maxEnemies;
/** Doubling-ish steps; the search stops at the first rung that misses budget. */
const LADDER = [100, 200, 400, 600, 800, 1200, 1600, 2400, 3200, 4800, 6400, 9600, 12800];
/** Bisection passes between the last rung that fit and the first that did not. */
const BISECT_STEPS = 4;

interface Variant {
  readonly label: string;
  readonly grid: boolean;
  readonly pools: boolean;
}

const VARIANTS: readonly Variant[] = [
  { label: 'brute-force collisions, no pool', grid: false, pools: false },
  { label: '+ spatial hash', grid: true, pools: false },
  { label: '+ object pool', grid: true, pools: true },
];

/**
 * The broad-phase removed, with the interface left intact: every query answers
 * with every enemy, so each consumer falls back to its own exact distance check
 * against the whole horde. This is the naive implementation, not a slower grid.
 */
class BruteGrid extends SpatialGrid {
  private readonly indices: number[] = [];

  constructor() {
    super(CONFIG.grid.cellSize);
  }

  override clear(): void {
    this.indices.length = 0;
  }

  override insert(index: number, _x: number, _y: number): void {
    this.indices.push(index);
  }

  override query(_x: number, _y: number, _radius: number, out: number[]): number[] {
    out.length = 0;
    for (let i = 0; i < this.indices.length; i++) {
      out.push(this.indices[i]);
    }
    return out;
  }
}

/** Recycling removed: every obtain allocates, every release drops the object. */
class NoPool<T> extends Pool<T> {
  private created = 0;

  constructor(private readonly make: () => T) {
    super(make, 0);
  }

  override obtain(): T {
    this.created++;
    return this.make();
  }

  override release(): void {}

  override get allocated(): number {
    return this.created;
  }

  override get available(): number {
    return 0;
  }
}

/**
 * `factory` is private to Pool, but an unpooled variant has to build exactly the
 * objects the real pool would — copying the shapes here would let them drift.
 */
function factoryOf<T>(pool: Pool<T>): () => T {
  return (pool as unknown as { factory: () => T }).factory;
}

/** The parts of a World this file swaps out. They are readonly by design. */
interface Swappable {
  grid: SpatialGrid;
  enemyPool: Pool<Enemy>;
  projectilePool: Pool<Projectile>;
  gemPool: Pool<Gem>;
  effectPool: Pool<Effect>;
}

/**
 * Switches the game's own spawner off for the duration of `body`.
 *
 * The bench holds the head count itself, and leaving the ceiling in place would
 * let a config constant rather than the implementation under test decide the
 * answer. `maxEnemies` is readonly to the compiler only because CONFIG is
 * declared `as const`; the cast is the whole reason this helper exists.
 */
function withoutGameSpawner(body: () => void): void {
  const spawnConfig = CONFIG.spawn as unknown as { maxEnemies: number };
  const saved = spawnConfig.maxEnemies;
  spawnConfig.maxEnemies = 0;
  try {
    body();
  } finally {
    spawnConfig.maxEnemies = saved;
  }
}

function buildWorld(variant: Variant): World {
  const world = new World(SEED);
  const swap = world as unknown as Swappable;

  if (!variant.grid) swap.grid = new BruteGrid();
  if (!variant.pools) {
    swap.enemyPool = new NoPool(factoryOf(world.enemyPool));
    swap.projectilePool = new NoPool(factoryOf(world.projectilePool));
    swap.gemPool = new NoPool(factoryOf(world.gemPool));
    swap.effectPool = new NoPool(factoryOf(world.effectPool));
  }

  for (const id of BUILD) applyUpgrade(world, world.players[0], id);
  world.players[0].pendingLevels = 0;
  world.players[0].offered = [];
  world.phase = 'playing';
  world.time = RUN_TIME;

  return world;
}

/** Re-spawns whatever died, so the next tick starts with exactly `count` alive. */
function topUp(world: World, count: number): void {
  const enemies = world.enemies;
  let alive = 0;
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].hp > 0) alive++;
  }
  for (let i = alive; i < count; i++) {
    spawnEnemy(world, rollEnemyDef(world), HP_SCALE);
  }
}

/**
 * This measures ticks, not a run. A player who dies or stops to pick an upgrade
 * stops the simulation, and a benchmark that quietly measured a frozen world
 * would report wonderful numbers.
 */
function keepPlaying(world: World): void {
  world.players[0].hp = world.players[0].stats.maxHp;
  if (world.phase !== 'playing') {
    world.players[0].pendingLevels = 0;
    world.players[0].offered = [];
    world.phase = 'playing';
  }
}

/** One measured unit: a full tick plus the respawn that holds the head count. */
function tick(world: World, count: number, index: number): void {
  const angle = index * 0.02;
  world.players[0].intentX = Math.cos(angle);
  world.players[0].intentY = Math.sin(angle);

  stepWorld(world, DT);
  keepPlaying(world);
  topUp(world, count);
}

interface Sample {
  readonly count: number;
  readonly p50: number;
  readonly pct: number;
  readonly max: number;
  readonly allocated: number;
}

/**
 * The reading for one head count: `REPEATS` independent runs, combined by
 * taking the lowest figure for each statistic. See REPEATS for why the minimum
 * and not the mean. The allocation count is identical in every repeat — the
 * simulation is deterministic — so it is simply carried through.
 */
function measure(variant: Variant, count: number): Sample {
  let best = measureOnce(variant, count);

  for (let i = 1; i < REPEATS; i++) {
    const next = measureOnce(variant, count);
    best = {
      count,
      p50: Math.min(best.p50, next.p50),
      pct: Math.min(best.pct, next.pct),
      max: Math.min(best.max, next.max),
      allocated: best.allocated,
    };
  }

  return best;
}

function measureOnce(variant: Variant, count: number): Sample {
  const world = buildWorld(variant);
  topUp(world, count);

  for (let i = 0; i < WARMUP_TICKS; i++) {
    tick(world, count, i);
  }

  // Allocation counters are read as a delta over the sampled window, so the
  // warm-up's own churn does not land in the reported figure.
  const allocatedBefore = totalAllocated(world);
  const times: number[] = [];

  for (let i = 0; i < SAMPLE_TICKS; i++) {
    const start = performance.now();
    tick(world, count, WARMUP_TICKS + i);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);

  return {
    count,
    p50: percentile(times, 50),
    pct: percentile(times, PERCENTILE),
    max: times[times.length - 1],
    allocated: totalAllocated(world) - allocatedBefore,
  };
}

function totalAllocated(world: World): number {
  return (
    world.enemyPool.allocated +
    world.projectilePool.allocated +
    world.gemPool.allocated +
    world.effectPool.allocated
  );
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

/**
 * Walks the ladder until a rung misses the budget, then bisects the gap. The
 * ladder alone would only ever answer to the nearest doubling.
 */
function capacity(variant: Variant, rows: string[]): number {
  let fits = 0;
  let misses = 0;

  for (const count of LADDER) {
    const sample = measure(variant, count);
    rows.push(row(variant, sample));

    if (sample.pct <= SIM_BUDGET_MS) {
      fits = count;
    } else {
      misses = count;
      break;
    }
  }

  if (misses === 0) return fits;

  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = Math.round((fits + misses) / 2 / 50) * 50;
    if (mid <= fits || mid >= misses) break;

    const sample = measure(variant, mid);
    rows.push(row(variant, sample));
    if (sample.pct <= SIM_BUDGET_MS) {
      fits = mid;
    } else {
      misses = mid;
    }
  }

  return fits;
}

function row(variant: Variant, sample: Sample): string {
  return [
    variant.label.padEnd(32),
    String(sample.count).padStart(6),
    `${sample.p50.toFixed(2)}ms`.padStart(10),
    `${sample.pct.toFixed(2)}ms`.padStart(10),
    `${sample.max.toFixed(2)}ms`.padStart(10),
    String(sample.allocated).padStart(9),
    (sample.pct <= SIM_BUDGET_MS ? 'fits' : 'over').padStart(7),
  ].join('');
}

it('measures how many enemies each implementation sustains', () => {
  const rows: string[] = [
    'implementation                  enemies       p50' +
      `      p${PERCENTILE}       max   allocs result`,
  ];
  const capacities: number[] = [];

  withoutGameSpawner(() => {
    for (const variant of VARIANTS) {
      capacities.push(capacity(variant, rows));
    }
  });

  rows.push('');
  rows.push(
    `budget: p${PERCENTILE} of the simulation tick under ${SIM_BUDGET_MS.toFixed(2)}ms ` +
      `(half of a ${FRAME_MS.toFixed(2)}ms frame at ${CONFIG.tickRate} fps)`,
  );
  rows.push(
    `each figure is the lowest of ${REPEATS} runs of ${SAMPLE_TICKS} ticks; ` +
      'allocs counts objects created inside one such run',
  );
  rows.push('');
  for (let i = 0; i < VARIANTS.length; i++) {
    rows.push(`${VARIANTS[i].label.padEnd(32)}${String(capacities[i]).padStart(6)} enemies`);
  }
  console.log('\n' + rows.join('\n') + '\n');

  // Guard rails, not targets.
  //
  // The broad-phase is a step change and has to stay one. The pool is a far
  // smaller effect — around a tenth of the tick — and a search for the exact
  // head count where p99 crosses the budget cannot resolve it: the two grid
  // variants land within a rung of each other and swap places between runs.
  // Holding it to "must not make things worse" is what the measurement can
  // actually support; what the pool does buy is measured at REFERENCE_COUNT.
  expect(capacities[1]).toBeGreaterThan(capacities[0] * 2);
  expect(capacities[2]).toBeGreaterThan(capacities[1] * 0.9);
});

/**
 * The same three implementations at the size the game ships with.
 *
 * The ladder above answers "how far could this go". This answers "what does a
 * tick cost at the head count the game caps itself to", which is the number
 * that decides whether the shipped game holds its frame rate — and it is where
 * the object pool's contribution is visible, because a capacity search at the
 * budget boundary is too coarse to see it.
 */
it(`compares the three at the ${REFERENCE_COUNT}-enemy ceiling the game ships with`, () => {
  const rows: string[] = [
    `at the shipped ceiling of ${REFERENCE_COUNT} enemies`,
    '',
    'implementation                  enemies       p50' +
      `      p${PERCENTILE}       max   allocs result`,
  ];
  const samples: Sample[] = [];

  withoutGameSpawner(() => {
    for (const variant of VARIANTS) {
      const sample = measure(variant, REFERENCE_COUNT);
      samples.push(sample);
      rows.push(row(variant, sample));
    }
  });

  console.log('\n' + rows.join('\n') + '\n');

  // The whole point of the ceiling: the shipped implementation is not close to
  // struggling with it.
  expect(samples[2].pct).toBeLessThan(SIM_BUDGET_MS / 2);
  // The pool is worth having at this size, in objects if not in milliseconds.
  expect(samples[2].allocated).toBeLessThan(samples[1].allocated);
});

/**
 * The three variants differ in speed and in nothing else.
 *
 * The grid is conservative and the pool overwrites every field on obtain, so
 * swapping either one out must leave the simulation bit-for-bit identical. If
 * this fails, the numbers above are comparing three different games.
 */
it('simulates identically whichever implementation is used', () => {
  withoutGameSpawner(() => {
    const outcomes = VARIANTS.map((variant) => {
      const world = buildWorld(variant);
      topUp(world, 300);
      for (let i = 0; i < 240; i++) tick(world, 300, i);
      return {
        kills: world.kills,
        xp: world.players[0].xp,
        gems: world.gems.length,
        enemies: world.enemies.length,
      };
    });

    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[0].kills).toBeGreaterThan(0);
  });
});
