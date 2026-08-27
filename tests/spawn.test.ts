import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { spawnSystem, waveIntensity } from '../src/systems/spawn';
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
  return Math.atan2(enemy.y - world.player.y, enemy.x - world.player.x);
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
    world.headingX = 1;
    world.headingY = 0;

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
    world.time = CONFIG.runDuration - CONFIG.spawn.bossLull;

    spawnFor(world, CONFIG.spawn.bossLull - 1);

    expect(world.enemies).toHaveLength(0);
    expect(world.bossSpawned).toBe(false);
  });

  it('spawns exactly one boss when the timer runs out', () => {
    const world = new World(2);
    world.time = CONFIG.runDuration - 0.5;

    spawnFor(world, 5);

    expect(world.bossSpawned).toBe(true);
    expect(world.enemies.filter((enemy) => enemy.boss)).toHaveLength(1);
    expect(world.enemies).toHaveLength(1);
  });
});
