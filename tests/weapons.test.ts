import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ENEMIES } from '../src/data/enemies';
import { UPGRADES } from '../src/data/upgrades';
import {
  NOVA,
  ORBIT,
  orbitDistance,
  orbitRadius,
  orbitSpin,
  weaponCooldown,
  weaponDamage,
} from '../src/data/weapons';
import { damageArea } from '../src/systems/damage';
import { effectSystem, spawnEffect } from '../src/systems/effects';
import { applyUpgrade } from '../src/systems/progression';
import { grantWeapon, weaponSystem } from '../src/systems/weapons';
import { rebuildGrid } from '../src/world/step';
import { World } from '../src/world/world';
import type { Enemy, WeaponState } from '../src/world/types';

const DT = 1 / 60;
const DUMMY_HP = 100;
/** Radius of the stand-in enemy, matching the common grunt. */
const ENEMY_RADIUS = 10;

/**
 * Drops a stationary, harmless enemy at an exact spot. The spawner only ever
 * places enemies on an off-screen ring, which is useless for asserting that a
 * weapon reaches precisely as far as it claims to.
 */
/**
 * The world's own state for a weapon. Scaling helpers read modifiers off it, so
 * asserting against a hand-built state would stop matching the moment a
 * per-weapon upgrade is involved.
 */
function weaponState(world: World, defId: string): WeaponState {
  const found = world.weapons.find((weapon) => weapon.defId === defId);
  if (found === undefined) throw new Error(`world has no weapon '${defId}'`);
  return found;
}

function placeEnemy(world: World, x: number, y: number): Enemy {
  const enemy = world.enemyPool.obtain();

  enemy.id = world.nextEntityId++;
  enemy.x = x;
  enemy.y = y;
  enemy.px = x;
  enemy.py = y;
  enemy.hp = DUMMY_HP;
  enemy.maxHp = DUMMY_HP;
  enemy.speed = 0;
  enemy.damage = 0;
  enemy.radius = ENEMY_RADIUS;
  enemy.xpValue = 1;
  enemy.color = 0xffffff;
  enemy.flash = 0;
  enemy.hitTag = 0;
  enemy.boss = false;

  world.enemies.push(enemy);
  return enemy;
}

describe('grantWeapon', () => {
  it('unlocks a weapon once and levels it afterwards', () => {
    const world = new World(1);
    expect(world.weapons).toHaveLength(1);

    grantWeapon(world, 'orbit');
    expect(world.weapons).toHaveLength(2);
    expect(world.weapons[1].level).toBe(1);

    grantWeapon(world, 'orbit');
    expect(world.weapons).toHaveLength(2);
    expect(world.weapons[1].level).toBe(2);
  });

  it('ignores an unknown weapon id', () => {
    const world = new World(1);
    grantWeapon(world, 'not-a-real-weapon');
    expect(world.weapons).toHaveLength(1);
  });
});

describe('weapon upgrades', () => {
  it('adds the weapon to the loadout when picked', () => {
    const world = new World(2);
    world.pendingLevels = 1;

    applyUpgrade(world, 'nova');

    expect(world.weapons.some((state) => state.defId === 'nova')).toBe(true);
    expect(world.stacks.get('nova')).toBe(1);
  });
});

describe('orbit blades', () => {
  it('damages what the ring passes through and nothing else', () => {
    const world = new World(3);
    grantWeapon(world, 'orbit');

    const onRing = placeEnemy(world, orbitDistance(ORBIT, weaponState(world, 'orbit')), 0);
    const outside = placeEnemy(world, 400, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(onRing.hp).toBeLessThan(DUMMY_HP);
    expect(outside.hp).toBe(DUMMY_HP);
  });

  /**
   * The blades are drawn every frame but only bite on their cooldown. Without
   * that an enemy standing in one would take sixty hits a second.
   */
  it('deals damage in pulses, not every tick', () => {
    const world = new World(3);
    grantWeapon(world, 'orbit');

    const enemy = placeEnemy(world, orbitDistance(ORBIT, weaponState(world, 'orbit')), 0);
    rebuildGrid(world);

    weaponSystem(world, DT);
    const afterPulse = enemy.hp;
    expect(afterPulse).toBeLessThan(DUMMY_HP);

    weaponSystem(world, DT);
    expect(enemy.hp).toBe(afterPulse);
  });

  it('hits harder at a higher level', () => {
    expect(pulseDamage(3)).toBeGreaterThan(pulseDamage(1));
  });

  /**
   * The ring's whole job, and the one thing it used to fail at.
   *
   * An enemy touching the player stands at `player.radius + enemy.radius`. A
   * ring that only bites further out is a hoop around a hole: it swings at
   * empty floor while something stands on the player. Every upgrade widened
   * that hole rather than closing it — levelling pushed the ring outward and
   * reach scaled it — so a fully bought ring dealt nothing within 95px of the
   * player it was supposed to be guarding.
   */
  it('cuts an enemy that has reached the player, at every level', () => {
    for (let level = 1; level <= stacksOf('orbit'); level++) {
      const world = new World(3);
      for (let i = 0; i < level; i++) grantWeapon(world, 'orbit');

      const touching = placeEnemy(world, CONFIG.player.radius + ENEMY_RADIUS, 0);
      rebuildGrid(world);

      // A full second of ticks, so the answer cannot rest on where the blades
      // happen to start.
      for (let tick = 0; tick < 60; tick++) weaponSystem(world, DT);

      expect(touching.hp).toBeLessThan(DUMMY_HP);
    }
  });

  /**
   * Damage is an instantaneous stamp at the pulse rather than a swept arc, so
   * the ring has to bite more often than it turns its own blade width.
   *
   * When it does not, enemies cross the arc between two samples untouched, and
   * that is exactly what happened: the ring travelled 0.96 rad between bites
   * while a blade covered 0.64. Whirling Edge widened the gap rather than
   * closing it, buying +50% spin against +40% rate.
   *
   * Checked at 1.0x global attack speed because that is the worst case — Quick
   * Hands shortens the cooldown without touching the spin, which can only help.
   */
  it('never turns further than a blade is wide between pulses', () => {
    // The smallest enemy is the hardest to catch, so it sets the bar.
    const smallest = ENEMIES.reduce((min, def) => Math.min(min, def.radius), Infinity);

    for (let level = 1; level <= stacksOf('orbit'); level++) {
      for (let spins = 0; spins <= stacksOf('orbit-spin'); spins++) {
        const world = new World(5);
        for (let i = 0; i < level; i++) grantWeapon(world, 'orbit');

        for (let i = 0; i < spins; i++) {
          world.pendingLevels = 1;
          applyUpgrade(world, 'orbit-spin');
        }

        const state = weaponState(world, 'orbit');
        const travelled = orbitSpin(ORBIT, state) * weaponCooldown(ORBIT, state, 1);
        const blade = (2 * (orbitRadius(ORBIT, state) + smallest)) / orbitDistance(ORBIT, state);

        expect(travelled).toBeLessThan(blade);
      }
    }
  });

  function stacksOf(id: string): number {
    const upgrade = UPGRADES.find((entry) => entry.id === id);
    if (upgrade === undefined) throw new Error(`no upgrade '${id}'`);
    return upgrade.maxStacks;
  }

  function pulseDamage(level: number): number {
    const world = new World(4);
    for (let i = 0; i < level; i++) grantWeapon(world, 'orbit');

    const enemy = placeEnemy(world, orbitDistance(ORBIT, weaponState(world, 'orbit')), 0);
    rebuildGrid(world);

    weaponSystem(world, DT);
    return DUMMY_HP - enemy.hp;
  }
});

describe('shockwave', () => {
  it('clears everything inside its radius and spares what is outside', () => {
    const world = new World(5);
    grantWeapon(world, 'nova');

    const inside = [placeEnemy(world, 40, 0), placeEnemy(world, -30, 50)];
    const outside = placeEnemy(world, NOVA.radius + 60, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    for (const enemy of inside) expect(enemy.hp).toBeLessThan(DUMMY_HP);
    expect(outside.hp).toBe(DUMMY_HP);
    expect(world.effects).toHaveLength(1);
  });

  it('scales with the player damage multiplier', () => {
    const world = new World(6);
    grantWeapon(world, 'nova');
    world.player.stats.damageMul = 2;

    const enemy = placeEnemy(world, 20, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(DUMMY_HP - enemy.hp).toBeCloseTo(weaponDamage(NOVA, weaponState(world, 'nova')) * 2);
  });
});

describe('damageArea', () => {
  /**
   * The de-duplication that lets a four-blade ring resolve as four separate
   * queries while still dealing its damage once per enemy.
   */
  it('hits each enemy once per damage event', () => {
    const world = new World(7);
    const enemy = placeEnemy(world, 0, 0);
    rebuildGrid(world);

    const event = world.nextDamageEvent();
    expect(damageArea(world, 0, 0, 50, 10, event)).toBe(1);
    expect(damageArea(world, 0, 0, 50, 10, event)).toBe(0);
    expect(enemy.hp).toBe(DUMMY_HP - 10);

    expect(damageArea(world, 0, 0, 50, 10, world.nextDamageEvent())).toBe(1);
    expect(enemy.hp).toBe(DUMMY_HP - 20);
  });
});

describe('effectSystem', () => {
  it('expires a ring and returns it to the pool', () => {
    const world = new World(8);
    spawnEffect(world, 0, 0, 100, 0.2, 0xffffff);
    expect(world.effects).toHaveLength(1);

    for (let i = 0; i < 20; i++) effectSystem(world, DT);

    expect(world.effects).toHaveLength(0);
    expect(world.effectPool.allocated).toBe(world.effectPool.available);
  });
});

/**
 * The second upgrade line each of these weapons got: rate, where the first one
 * bought only reach. Reach covers more ground but kills nothing faster, so a
 * weapon with reach alone stops scaling exactly when the horde stops thinning.
 */
describe('rate upgrades', () => {
  it('turns the blade ring faster and cuts more often', () => {
    const world = new World(30);
    grantWeapon(world, 'orbit');

    const state = weaponState(world, 'orbit');
    weaponSystem(world, DT);
    const baseSpin = state.angle;
    const basePulse = state.cooldown;

    world.pendingLevels = 1;
    applyUpgrade(world, 'orbit-spin');

    state.angle = 0;
    state.cooldown = 0;
    weaponSystem(world, DT);

    expect(state.angle).toBeCloseTo(baseSpin * 1.5);
    expect(state.cooldown).toBeCloseTo(basePulse / 1.4);
  });

  it('bursts the shockwave more often without touching the others', () => {
    const world = new World(31);
    grantWeapon(world, 'nova');
    grantWeapon(world, 'orbit');

    weaponSystem(world, DT);
    const baseNova = weaponState(world, 'nova').cooldown;
    const baseOrbit = weaponState(world, 'orbit').cooldown;

    world.pendingLevels = 1;
    applyUpgrade(world, 'nova-cadence');

    weaponState(world, 'nova').cooldown = 0;
    weaponState(world, 'orbit').cooldown = 0;
    weaponSystem(world, DT);

    expect(weaponState(world, 'nova').cooldown).toBeCloseTo(baseNova / 1.4);
    expect(weaponState(world, 'orbit').cooldown).toBeCloseTo(baseOrbit);
  });

  it('keeps the global attack speed multiplying on top of the weapon one', () => {
    const world = new World(32);
    grantWeapon(world, 'nova');

    weaponSystem(world, DT);
    const base = weaponState(world, 'nova').cooldown;

    world.pendingLevels = 2;
    applyUpgrade(world, 'nova-cadence');
    applyUpgrade(world, 'haste');

    weaponState(world, 'nova').cooldown = 0;
    weaponSystem(world, DT);

    expect(weaponState(world, 'nova').cooldown).toBeCloseTo(base / (1.4 * 1.2));
  });
});
