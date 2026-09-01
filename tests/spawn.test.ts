import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { bossHpScale, defeatBoss, spawnSystem, waveIntensity } from '../src/systems/spawn';
import { World } from '../src/world/world';

const DT = 1 / CONFIG.tickRate;

/** Runs the spawner for `seconds` without moving anything else. */
function spawnFor(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * CONFIG.tickRate); i++) {
    world.time += DT;
    spawnSystem(world, DT);
  }
}

/** Signed angle of an enemy as seen from the player, in [-PI, PI]. */
function bearing(world: World, index: number): number {
  const enemy = world.enemies[index];
  return Math.atan2(enemy.y - world.players[0].y, enemy.x - world.players[0].x);
}

describe('waveIntensity', () => {
  it('sits at the base rate outside a surge', () => {
    expect(waveIntensity(CONFIG.spawn.waveSurge)).toBe(1);
    expect(waveIntensity(CONFIG.spawn.wavePeriod - 1)).toBe(1);
    expect(waveIntensity(0)).toBe(1);
  });

  it('peaks in the middle of the surge', () => {
    expect(waveIntensity(CONFIG.spawn.waveSurge / 2)).toBeCloseTo(CONFIG.spawn.wavePeak);
  });

  it('never dips below the base rate and repeats every period', () => {
    for (let t = 0; t < CONFIG.spawn.wavePeriod * 3; t += 0.25) {
      expect(waveIntensity(t)).toBeGreaterThanOrEqual(1);
      expect(waveIntensity(t)).toBeCloseTo(waveIntensity(t + CONFIG.spawn.wavePeriod));
    }
  });

  /** A rate that doubles between two ticks reads as a bug, not as a wave. */
  it('is continuous where the surge ends', () => {
    const justInside = waveIntensity(CONFIG.spawn.waveSurge - 0.01);
    expect(justInside).toBeGreaterThan(1);
    expect(justInside).toBeLessThan(1.05);
  });
});

describe('spawn placement', () => {
  it('puts most of the horde in the player path', () => {
    const world = new World(1);
    world.players[0].headingX = 1;
    world.players[0].headingY = 0;

    spawnFor(world, 40);
    expect(world.enemies.length).toBeGreaterThan(40);

    let ahead = 0;
    for (let i = 0; i < world.enemies.length; i++) {
      if (Math.abs(bearing(world, i)) <= CONFIG.spawn.aheadSpread) ahead++;
    }

    const fraction = ahead / world.enemies.length;
    // A uniform ring would land this arc about 32% of the time.
    expect(fraction).toBeGreaterThan(0.55);
    // ...but not all of it, or running in a circle would be free.
    expect(fraction).toBeLessThan(0.95);
  });

  it('falls back to the whole ring when the player is standing still', () => {
    const world = new World(1);
    spawnFor(world, 40);

    let ahead = 0;
    for (let i = 0; i < world.enemies.length; i++) {
      if (Math.abs(bearing(world, i)) <= CONFIG.spawn.aheadSpread) ahead++;
    }

    expect(ahead / world.enemies.length).toBeLessThan(0.5);
  });
});

describe('boss arrival', () => {
  it('stops spawning during the lull before the boss', () => {
    const world = new World(2);
    world.time = world.nextBossAt - CONFIG.boss.lull;

    spawnFor(world, CONFIG.boss.lull - 1);

    expect(world.enemies).toHaveLength(0);
    expect(world.bossSpawned).toBe(false);
  });

  it('spawns exactly one boss when the timer runs out', () => {
    const world = new World(2);
    world.time = world.nextBossAt - 0.5;

    spawnFor(world, 5);

    expect(world.bossSpawned).toBe(true);
    expect(world.enemies.filter((enemy) => enemy.boss)).toHaveLength(1);
    expect(world.enemies).toHaveLength(1);
  });
});

describe('the boss cycle', () => {
  /** Runs the spawner up to the boss and puts it on the field. */
  function summonBoss(world: World): void {
    world.time = world.nextBossAt - 0.5;
    spawnFor(world, 1);
    expect(world.bossSpawned).toBe(true);
  }

  it('resumes the horde once the boss is down', () => {
    const world = new World(3);
    summonBoss(world);

    defeatBoss(world);
    spawnFor(world, 5);

    expect(world.bossSpawned).toBe(false);
    expect(world.bossesKilled).toBe(1);
    expect(world.enemies.length).toBeGreaterThan(0);
  });

  it('measures the next arrival from the kill, not from a fixed grid', () => {
    const world = new World(3);
    summonBoss(world);
    // A long duel: the breather afterwards has to be a full interval even so.
    world.time += 90;

    const killedAt = world.time;
    defeatBoss(world);

    expect(world.nextBossAt).toBeCloseTo(killedAt + CONFIG.boss.interval);
  });

  it('sends a second boss, and a harder one', () => {
    const world = new World(3);
    summonBoss(world);
    const first = world.enemies[0].maxHp;

    defeatBoss(world);
    world.enemies.length = 0;
    summonBoss(world);

    const second = world.enemies.filter((enemy) => enemy.boss);
    expect(second).toHaveLength(1);
    expect(second[0].maxHp).toBeGreaterThan(first);
    expect(second[0].maxHp).toBeCloseTo(first * bossHpScale(world));
  });

  it('does not end the run', () => {
    const world = new World(3);
    summonBoss(world);

    defeatBoss(world);

    expect(world.phase).toBe('playing');
  });

  it('keeps the duel quiet while the grace lasts', () => {
    const world = new World(4);
    summonBoss(world);
    world.enemies.length = 0;

    spawnFor(world, CONFIG.boss.duelGrace - 2);

    expect(world.bossSpawned).toBe(true);
    expect(world.enemies).toHaveLength(0);
  });

  it('sends the horde back at a boss the player cannot finish', () => {
    const world = new World(4);
    summonBoss(world);
    world.enemies.length = 0;

    // Past the grace and still no kill: the duel stops being a place to rest.
    spawnFor(world, CONFIG.boss.duelGrace + 5);

    expect(world.bossSpawned).toBe(true);
    expect(world.enemies.length).toBeGreaterThan(0);
  });

  it('measures the grace from the arrival, not from the schedule', () => {
    const world = new World(4);
    // Late to its own appointment: the world was paused, or a frame was long.
    world.time = world.nextBossAt + 30;
    spawnFor(world, 1);

    expect(world.bossSpawned).toBe(true);
    expect(world.hordeResumesAt).toBeCloseTo(world.time - 1 + CONFIG.boss.duelGrace, 0);
  });
});
