import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/data/upgrades';
import {
  applyUpgrade,
  isOfferable,
  progressionSystem,
  rollUpgrades,
  xpForLevel,
} from '../src/systems/progression';
import { grantWeapon } from '../src/systems/weapons';
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

  it('fills all four cards while the pool can', () => {
    const world = new World(30);

    expect(rollUpgrades(world)).toHaveLength(4);
  });

  it('offers distinct upgrades', () => {
    const world = new World(7);
    for (let i = 0; i < 40; i++) {
      const ids = rollUpgrades(world, 3).map((offer) => offer.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('offer filtering by ownership', () => {
  const ORBIT_MODS = UPGRADES.filter(
    (upgrade) => upgrade.kind === 'weaponMod' && upgrade.weaponId === 'orbit',
  );

  it('has weapon modifiers to filter in the first place', () => {
    expect(ORBIT_MODS.length).toBeGreaterThan(0);
  });

  it('does not offer a modifier for a weapon the player lacks', () => {
    const world = new World(11);

    expect(world.weapons.some((weapon) => weapon.defId === 'orbit')).toBe(false);
    for (const mod of ORBIT_MODS) expect(isOfferable(world, mod)).toBe(false);
  });

  it('offers it once the weapon is owned', () => {
    const world = new World(11);
    grantWeapon(world, 'orbit');

    for (const mod of ORBIT_MODS) expect(isOfferable(world, mod)).toBe(true);
  });

  it('always offers modifiers for the starter weapon, which is never absent', () => {
    const world = new World(12);
    const boltMods = UPGRADES.filter(
      (upgrade) => upgrade.kind === 'weaponMod' && upgrade.weaponId === 'bolt',
    );

    expect(boltMods.length).toBeGreaterThan(0);
    for (const mod of boltMods) expect(isOfferable(world, mod)).toBe(true);
  });

  it('keeps unowned modifiers out of a roll entirely', () => {
    const world = new World(13);
    const unowned = new Set(ORBIT_MODS.map((mod) => mod.id));

    // Many rolls, because a single one only samples three of the pool.
    for (let i = 0; i < 200; i++) {
      for (const offer of rollUpgrades(world)) {
        expect(unowned.has(offer.id)).toBe(false);
      }
    }
  });

  it('refuses to apply a modifier for a weapon the player lacks', () => {
    const world = new World(14);
    const mod = ORBIT_MODS[0];
    world.pendingLevels = 1;

    applyUpgrade(world, mod.id);

    expect(world.stacks.get(mod.id) ?? 0).toBe(0);
  });

  it('applies a modifier to the named weapon and leaves the others alone', () => {
    const world = new World(15);
    grantWeapon(world, 'orbit');
    world.pendingLevels = 1;

    const mod = ORBIT_MODS[0];
    const orbit = world.weapons.find((weapon) => weapon.defId === 'orbit');
    const bolt = world.weapons.find((weapon) => weapon.defId === 'bolt');
    if (orbit === undefined || bolt === undefined) throw new Error('missing weapon');

    const boltBefore = { ...bolt };
    applyUpgrade(world, mod.id);

    expect(world.stacks.get(mod.id)).toBe(1);
    expect(orbit.areaMul * orbit.attackSpeedMul).toBeGreaterThan(1);
    expect(bolt).toEqual(boltBefore);
  });
});
