import { describe, expect, it } from 'vitest';
import { NOVA, ORBIT, orbitDistance, weaponDamage } from '../src/data/weapons';
import { damageArea } from '../src/systems/damage';
import { effectSystem, spawnEffect } from '../src/systems/effects';
import { applyUpgrade } from '../src/systems/progression';
import { grantWeapon, weaponSystem } from '../src/systems/weapons';
import { rebuildGrid } from '../src/world/step';
import { World } from '../src/world/world';
import type { Enemy } from '../src/world/types';

const DT = 1 / 60;
const DUMMY_HP = 100;

/**
 * Drops a stationary, harmless enemy at an exact spot. The spawner only ever
 * places enemies on an off-screen ring, which is useless for asserting that a
 * weapon reaches precisely as far as it claims to.
 */
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
  enemy.radius = 10;
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

    const onRing = placeEnemy(world, orbitDistance(ORBIT, 1), 0);
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

    const enemy = placeEnemy(world, orbitDistance(ORBIT, 1), 0);
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

  function pulseDamage(level: number): number {
    const world = new World(4);
    for (let i = 0; i < level; i++) grantWeapon(world, 'orbit');

    const enemy = placeEnemy(world, orbitDistance(ORBIT, level), 0);
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

    expect(DUMMY_HP - enemy.hp).toBeCloseTo(weaponDamage(NOVA, 1) * 2);
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
