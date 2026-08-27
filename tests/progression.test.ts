import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/data/upgrades';
import { applyUpgrade, progressionSystem, rollUpgrades, xpForLevel } from '../src/systems/progression';
import { World } from '../src/world/world';

describe('xpForLevel', () => {
  it('grows strictly with level', () => {
    for (let level = 1; level < 200; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });
});

describe('progressionSystem', () => {
  it('converts banked xp into levels and queues one choice each', () => {
    const world = new World(1);
    world.player.xp = xpForLevel(1) + xpForLevel(2);

    progressionSystem(world);

    expect(world.player.level).toBe(3);
    expect(world.pendingLevels).toBe(2);
    expect(world.phase).toBe('levelup');
    expect(world.offered.length).toBeGreaterThan(0);
  });

  it('leaves the remainder banked toward the next level', () => {
    const world = new World(1);
    world.player.xp = xpForLevel(1) + 3;

    progressionSystem(world);

    expect(world.player.level).toBe(2);
    expect(world.player.xp).toBe(3);
  });
});

describe('applyUpgrade', () => {
  it('resumes the run once the last queued level is spent', () => {
    const world = new World(2);
    world.player.xp = xpForLevel(1);
    progressionSystem(world);

    applyUpgrade(world, world.offered[0].id);

    expect(world.pendingLevels).toBe(0);
    expect(world.phase).toBe('playing');
    expect(world.offered).toHaveLength(0);
  });

  it('offers the next choice while levels remain queued', () => {
    const world = new World(2);
    world.player.xp = xpForLevel(1) + xpForLevel(2);
    progressionSystem(world);

    applyUpgrade(world, world.offered[0].id);

    expect(world.pendingLevels).toBe(1);
    expect(world.phase).toBe('levelup');
  });

  it('never exceeds an upgrade max stacks', () => {
    const world = new World(3);
    const damage = UPGRADES.find((upgrade) => upgrade.id === 'damage');
    expect(damage).toBeDefined();

    world.pendingLevels = 50;
    for (let i = 0; i < 50; i++) applyUpgrade(world, 'damage');

    expect(world.stacks.get('damage')).toBe(damage?.maxStacks);
  });

  it('heals by exactly the max hp it grants', () => {
    const world = new World(4);
    world.player.hp = 10;
    world.pendingLevels = 1;
    const before = world.player.stats.maxHp;

    applyUpgrade(world, 'vitality');

    expect(world.player.stats.maxHp).toBe(before + 25);
    expect(world.player.hp).toBe(35);
  });

  it('ignores an unknown id instead of consuming the level', () => {
    const world = new World(5);
    world.pendingLevels = 1;

    applyUpgrade(world, 'not-a-real-upgrade');

    expect(world.pendingLevels).toBe(1);
  });
});

describe('rollUpgrades', () => {
  it('stops offering an upgrade that is maxed out', () => {
    const world = new World(6);
    const pierce = UPGRADES.find((upgrade) => upgrade.id === 'pierce');
    expect(pierce).toBeDefined();

    world.stacks.set('pierce', pierce?.maxStacks ?? 0);

    for (let i = 0; i < 40; i++) {
      const offers = rollUpgrades(world, 3);
      expect(offers.some((offer) => offer.id === 'pierce')).toBe(false);
    }
  });

  it('offers distinct upgrades', () => {
    const world = new World(7);
    for (let i = 0; i < 40; i++) {
      const ids = rollUpgrades(world, 3).map((offer) => offer.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
