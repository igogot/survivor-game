import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ENEMIES } from '../src/data/enemies';
import { UPGRADES } from '../src/data/upgrades';
import { EMBER, trailRadius, trailSpacing, weaponCooldown, weaponDamage } from '../src/data/weapons';
import { applyUpgrade } from '../src/systems/progression';
import { MAX_FLAMES, trailSystem } from '../src/systems/trail';
import { grantWeapon, weaponSystem } from '../src/systems/weapons';
import { rebuildGrid } from '../src/world/step';
import { World } from '../src/world/world';
import type { Enemy, WeaponState } from '../src/world/types';

const DT = 1 / 60;
const DUMMY_HP = 1000;
const ENEMY_RADIUS = 10;

/**
 * A world holding the trail and nothing else that fires.
 *
 * The starter bolt is still there — every world has one — but it needs a target
 * inside 430 to spend a shot, and nothing here is placed that close by accident.
 */
function trailWorld(seed: number, levels = 1): World {
  const world = new World(seed);
  for (let i = 0; i < levels; i++) grantWeapon(world.players[0], 'ember');
  return world;
}

function state(world: World): WeaponState {
  const found = world.players[0].weapons.find((weapon) => weapon.defId === 'ember');
  if (found === undefined) throw new Error('world has no ember trail');
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

/** Walks the player `distance` along +x in one hop, then runs the weapon. */
function walk(world: World, distance: number): void {
  world.players[0].x += distance;
  weaponSystem(world, DT);
}

function stacksOf(id: string): number {
  const upgrade = UPGRADES.find((entry) => entry.id === id);
  if (upgrade === undefined) throw new Error(`no upgrade '${id}'`);
  return upgrade.maxStacks;
}

describe('laying the trail', () => {
  /**
   * The rule the weapon is built on. Patches go down by distance covered, not
   * on a clock, which is what makes the ribbon continuous at any speed.
   */
  it('lays a patch once the player has walked one spacing, and not before', () => {
    const world = trailWorld(1);
    const spacing = trailSpacing(EMBER, state(world));

    walk(world, spacing * 0.9);
    expect(world.flames).toHaveLength(0);

    walk(world, spacing * 0.2);
    expect(world.flames).toHaveLength(1);
  });

  /**
   * The price the weapon charges, and its whole shape: a player who stops
   * moving stops burning. The patch under them runs out and nothing replaces
   * it.
   */
  it('lays nothing at all while the player stands still', () => {
    const world = trailWorld(2);
    walk(world, trailSpacing(EMBER, state(world)));
    expect(world.flames).toHaveLength(1);

    for (let tick = 0; tick < 240; tick++) weaponSystem(world, DT);
    expect(world.flames).toHaveLength(1);
  });

  /** Where the player was, not where they are going. */
  it('lays the patch under the player and leaves it there', () => {
    const world = trailWorld(3);
    const spacing = trailSpacing(EMBER, state(world));

    walk(world, spacing);
    const flame = world.flames[0];
    expect(flame.x).toBe(spacing);
    expect(flame.y).toBe(0);

    walk(world, spacing);
    expect(world.flames).toHaveLength(2);
    expect(flame.x).toBe(spacing);
  });

  /**
   * A patch is what the weapon was when it laid it. Levelling widens the next
   * one and leaves the fire already on the ground alone.
   */
  it('freezes a patch at the width it was laid with', () => {
    const world = trailWorld(4);
    walk(world, trailSpacing(EMBER, state(world)));

    const laid = world.flames[0].radius;
    expect(laid).toBe(trailRadius(EMBER, state(world)));

    grantWeapon(world.players[0], 'ember');
    expect(trailRadius(EMBER, state(world))).toBeGreaterThan(laid);
    expect(world.flames[0].radius).toBe(laid);
  });

  /**
   * Spacing is a fraction of the radius, so a wider trail is laid in fewer,
   * bigger patches. That is what keeps a fully bought weapon from costing more
   * broad-phase queries per burn than a fresh one.
   */
  it('lays fewer patches over the same ground as the fire widens', () => {
    expect(patchesOver(600, 1)).toBeGreaterThan(patchesOver(600, stacksOf('ember')));
  });

  function patchesOver(distance: number, levels: number): number {
    const world = trailWorld(5, levels);
    const step = 2;
    for (let walked = 0; walked < distance; walked += step) walk(world, step);
    return world.flames.length;
  }
});

describe('burning', () => {
  it('burns what stands in the fire and spares what does not', () => {
    const world = trailWorld(6);
    const radius = trailRadius(EMBER, state(world));

    walk(world, trailSpacing(EMBER, state(world)));
    const flame = world.flames[0];

    const inside = placeEnemy(world, flame.x, flame.y);
    const outside = placeEnemy(world, flame.x, flame.y + radius + ENEMY_RADIUS + 5);
    rebuildGrid(world);

    // The lay above consumed the opening burn, so run out the cooldown.
    for (let tick = 0; tick < Math.ceil(EMBER.cooldown / DT) + 1; tick++) {
      weaponSystem(world, DT);
    }

    expect(inside.hp).toBeLessThan(DUMMY_HP);
    expect(outside.hp).toBe(DUMMY_HP);
  });

  /**
   * The invariant the whole trail resolves on. A ribbon is a few dozen
   * overlapping circles, so an enemy walking down the middle of one stands in
   * four or five patches at once — and must take one hit, not five. Otherwise
   * the weapon's damage would depend on how tightly the player was turning.
   */
  it('hits an enemy standing in five patches exactly once per burn', () => {
    const world = trailWorld(7);
    const spacing = trailSpacing(EMBER, state(world));

    // Five patches laid on top of each other, by walking a ring smaller than
    // one patch: every one of them covers the origin.
    for (let i = 0; i < 5; i++) {
      world.players[0].x = Math.cos((i * Math.PI * 2) / 5) * spacing * 0.4;
      world.players[0].y = Math.sin((i * Math.PI * 2) / 5) * spacing * 0.4;
      // Far enough from the previous patch to lay a new one, close enough that
      // all five still reach the origin.
      state(world).trailX = 1e6;
      weaponSystem(world, DT);
    }
    expect(world.flames).toHaveLength(5);

    const enemy = placeEnemy(world, 0, 0);
    rebuildGrid(world);

    const burn = weaponDamage(EMBER, state(world)) * world.players[0].stats.damageMul;
    state(world).cooldown = 0;
    weaponSystem(world, DT);

    expect(DUMMY_HP - enemy.hp).toBeCloseTo(burn);
  });

  /** Fire bites on a clock like every other weapon, not sixty times a second. */
  it('burns in pulses rather than every tick', () => {
    const world = trailWorld(8);
    walk(world, trailSpacing(EMBER, state(world)));

    const enemy = placeEnemy(world, world.flames[0].x, 0);
    rebuildGrid(world);

    state(world).cooldown = 0;
    weaponSystem(world, DT);
    const afterBurn = enemy.hp;
    expect(afterBurn).toBeLessThan(DUMMY_HP);

    weaponSystem(world, DT);
    expect(enemy.hp).toBe(afterBurn);
  });

  it('burns harder at a higher level and with a damage multiplier', () => {
    expect(burnDamage(2, 1)).toBeGreaterThan(burnDamage(1, 1));
    expect(burnDamage(1, 2)).toBeCloseTo(burnDamage(1, 1) * 2);
  });

  function burnDamage(levels: number, damageMul: number): number {
    const world = trailWorld(9, levels);
    world.players[0].stats.damageMul = damageMul;
    walk(world, trailSpacing(EMBER, state(world)));

    const enemy = placeEnemy(world, world.flames[0].x, 0);
    rebuildGrid(world);

    state(world).cooldown = 0;
    weaponSystem(world, DT);
    return DUMMY_HP - enemy.hp;
  }
});

/**
 * The orbit ring's skipping problem, in a straight line.
 *
 * Damage is an instantaneous stamp rather than a swept area, so an enemy
 * crossing the ribbon has to be standing in it when a burn lands. The ring
 * failed exactly this check once — it turned 0.96 rad between bites while a
 * blade covered 0.64 — and the failure was invisible until it was measured.
 */
describe('the burn cannot be crossed', () => {
  /** The fastest thing in the horde sets the bar; nothing else is harder. */
  const fastest = ENEMIES.reduce((max, def) => Math.max(max, def.speed), 0);

  it('burns more often than the fastest enemy walks across a patch', () => {
    for (let level = 1; level <= stacksOf('ember'); level++) {
      for (let spreads = 0; spreads <= stacksOf('ember-spread'); spreads++) {
        const world = trailWorld(10, level);

        for (let i = 0; i < spreads; i++) {
          world.players[0].pendingLevels = 1;
          applyUpgrade(world, world.players[0], 'ember-spread');
        }

        // 1.0x global attack speed is the worst case: Quick Hands and White
        // Heat only shorten the interval, which can only help.
        const interval = weaponCooldown(EMBER, state(world), 1);
        const crossing = (2 * trailRadius(EMBER, state(world))) / fastest;

        expect(interval, `level ${level}, ${spreads} spreads`).toBeLessThan(crossing);
      }
    }
  });

  /**
   * The bar is set by the narrowest fire, which is the one at level 1 with
   * nothing bought — so widening the trail can never break the invariant.
   */
  it('never narrows below the width it starts at', () => {
    const world = trailWorld(11);
    const base = trailRadius(EMBER, state(world));

    grantWeapon(world.players[0], 'ember');
    world.players[0].pendingLevels = 1;
    applyUpgrade(world, world.players[0], 'ember-spread');

    expect(trailRadius(EMBER, state(world))).toBeGreaterThan(base);
  });
});

describe('patches on the ground', () => {
  it('burns out after its life and returns to the pool', () => {
    const world = trailWorld(12);
    walk(world, trailSpacing(EMBER, state(world)));
    expect(world.flames).toHaveLength(1);

    for (let tick = 0; tick < Math.ceil(EMBER.life / DT) + 1; tick++) {
      trailSystem(world, DT);
    }

    expect(world.flames).toHaveLength(0);
    expect(world.flamePool.allocated).toBe(world.flamePool.available);
  });

  /**
   * The backstop. It is not reached by any real run — the trail's length is
   * `life * moveSpeed / spacing`, around forty at its widest point — but a
   * weapon that can put entities in the world needs a ceiling for the same
   * reason the horde has one.
   */
  it('never lays more patches than the cap allows', () => {
    const world = trailWorld(13);
    const spacing = trailSpacing(EMBER, state(world));

    for (let i = 0; i < MAX_FLAMES * 2; i++) {
      // Ageing is deliberately skipped: nothing burns out, so the only thing
      // that can stop the trail growing is the cap itself.
      walk(world, spacing);
    }

    expect(world.flames).toHaveLength(MAX_FLAMES);
  });

  /**
   * A trail stopped by the cap resumes from where it stopped. Advancing the
   * record of the last patch on a lay that never happened would leave a hole
   * the length of however far the player ran while the cap was full.
   */
  it('picks the trail back up where the cap interrupted it', () => {
    const world = trailWorld(14);
    const spacing = trailSpacing(EMBER, state(world));

    for (let i = 0; i < MAX_FLAMES; i++) walk(world, spacing);
    const lastLaid = state(world).trailX;

    walk(world, spacing * 10);
    expect(state(world).trailX).toBe(lastLaid);

    // One patch expires, and the very next tick puts one down again.
    world.flames[0].life = 0;
    trailSystem(world, DT);
    weaponSystem(world, DT);

    expect(world.flames).toHaveLength(MAX_FLAMES);
    expect(state(world).trailX).toBe(world.players[0].x);
  });
});

/**
 * Nothing else in the game is laid on the ground and left there, so a run has
 * to be able to end while fire is still burning — and the fire must not be the
 * thing that keeps the tick alive.
 */
describe('the trail inside a run', () => {
  it('is laid, burnt and cleared over a stepped run without touching the pool twice', () => {
    const world = trailWorld(15);
    world.players[0].x = 0;

    for (let tick = 0; tick < 600; tick++) {
      world.players[0].x += (CONFIG.player.moveSpeed * DT) / 2;
      weaponSystem(world, DT);
      trailSystem(world, DT);
    }

    expect(world.flames.length).toBeGreaterThan(0);
    expect(world.flames.length).toBeLessThanOrEqual(MAX_FLAMES);
    // Every patch alive came out of the pool and every dead one went back, so
    // the pool never grew past the longest the trail has ever been.
    expect(world.flamePool.allocated).toBeGreaterThanOrEqual(world.flames.length);
    expect(world.flamePool.available).toBe(world.flamePool.allocated - world.flames.length);
  });
});
