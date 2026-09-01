import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { runHeadless } from './helpers';

describe('headless simulation', () => {
  it('plays a run with no browser present', () => {
    const world = runHeadless(42, 90);

    expect(world.time).toBeGreaterThan(0);
    expect(world.kills).toBeGreaterThan(0);
    expect(world.level).toBeGreaterThan(1);
  });

  it('produces an identical run for the same seed', () => {
    const first = runHeadless(1337, 60);
    const second = runHeadless(1337, 60);

    expect(first.kills).toBe(second.kills);
    expect(first.level).toBe(second.level);
    expect(first.players[0].hp).toBe(second.players[0].hp);
    expect(first.enemies.length).toBe(second.enemies.length);
  });

  it('respects the enemy ceiling that protects the frame rate', () => {
    const world = runHeadless(99, 240);

    // A batch may overshoot the check by its own size, never more.
    expect(world.enemies.length).toBeLessThanOrEqual(CONFIG.spawn.maxEnemies + 64);
  });

  /**
   * The pool invariant: every object ever created is either alive in the world
   * or sitting in the free list. Anything else means a double release (the same
   * object handed out twice) or a leak (never returned).
   */
  it('accounts for every pooled object', () => {
    const world = runHeadless(7, 180);

    expect(world.enemyPool.allocated).toBe(world.enemies.length + world.enemyPool.available);
    expect(world.gemPool.allocated).toBe(world.gems.length + world.gemPool.available);
    expect(world.projectilePool.allocated).toBe(
      world.projectiles.length + world.projectilePool.available,
    );
    expect(world.effectPool.allocated).toBe(world.effects.length + world.effectPool.available);
  });

  it('stops allocating enemies once the pool is warm', () => {
    const short = runHeadless(11, 60);
    const long = runHeadless(11, 240);

    // Four times the duration must not mean four times the allocations — the
    // count is bounded by peak concurrent enemies, not by total spawns.
    expect(long.enemyPool.allocated).toBeLessThan(short.enemyPool.allocated * 3);
  });
});
