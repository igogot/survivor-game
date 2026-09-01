import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { canPause, pauseRun, resumeRun } from '../src/world/pause';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import { progressionSystem, xpForLevel } from '../src/systems/progression';

const DT = 1 / CONFIG.tickRate;

/** Walks the world forward so there is something to freeze. */
function play(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * CONFIG.tickRate); i++) {
    world.players[0].intentX = 1;
    world.players[0].intentY = 0;
    stepWorld(world, DT);
  }
}

describe('pauseRun', () => {
  it('freezes the run where it stands', () => {
    const world = new World(1);
    play(world, 20);

    const time = world.time;
    const enemies = world.enemies.length;
    const x = world.players[0].x;
    expect(enemies).toBeGreaterThan(0);

    pauseRun(world);
    expect(world.phase).toBe('paused');

    play(world, 20);

    // The run timer and the spawn curve are both functions of world.time, so
    // freezing it is what keeps a pause from making the next minute harder.
    expect(world.time).toBe(time);
    expect(world.enemies.length).toBe(enemies);
    expect(world.players[0].x).toBe(x);
  });

  it('returns to playing on resume', () => {
    const world = new World(2);
    play(world, 5);

    pauseRun(world);
    resumeRun(world);

    expect(world.phase).toBe('playing');

    const time = world.time;
    play(world, 2);
    expect(world.time).toBeGreaterThan(time);
  });

  /** Otherwise pausing would be a way to skip the choice and keep playing. */
  it('gives the level-up choice back instead of swallowing it', () => {
    const world = new World(3);
    world.xp = xpForLevel(1);
    progressionSystem(world);
    expect(world.phase).toBe('levelup');

    const offered = world.players[0].offered;
    const pending = world.players[0].pendingLevels;

    pauseRun(world);
    expect(world.phase).toBe('paused');

    resumeRun(world);
    expect(world.phase).toBe('levelup');
    expect(world.players[0].offered).toBe(offered);
    expect(world.players[0].pendingLevels).toBe(pending);
  });

  it('refuses to pause a finished run', () => {
    const world = new World(4);
    world.phase = 'dead';

    expect(canPause(world)).toBe(false);
    pauseRun(world);

    expect(world.phase).toBe('dead');
  });

  it('ignores a resume that was never paused', () => {
    const world = new World(5);
    resumeRun(world);
    expect(world.phase).toBe('playing');
  });
});
