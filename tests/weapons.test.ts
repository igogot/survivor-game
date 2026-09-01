import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ENEMIES } from '../src/data/enemies';
import { UPGRADES } from '../src/data/upgrades';
import {
  BOLT,
  HARPOON,
  NOVA,
  ORBIT,
  SPEAR,
  orbitDistance,
  orbitRadius,
  orbitSpin,
  spearLength,
  spearThickness,
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
describe('lunge spear', () => {
  /**
   * The lance points at the nearest body, not at the player's heading. An
   * earlier version read the heading, which pointed the weapon at empty space
   * for anyone kiting; this pins the rule the balance stand paid for.
   */
  it('points the lance at the nearest enemy, not along the heading', () => {
    const world = new World(7);
    grantWeapon(world, 'spear');
    world.headingX = 1;
    world.headingY = 0;

    const ahead = placeEnemy(world, 100, 0);
    const behind = placeEnemy(world, -40, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(behind.hp).toBeLessThan(DUMMY_HP);
    expect(ahead.hp).toBe(DUMMY_HP);
  });

  /**
   * Piercing is the shape of this weapon rather than a stat it buys: the lance
   * is one damage event, so a queue costs one thrust and nobody in it is hit
   * twice for standing where two parts of the line overlap.
   */
  it('skewers a queue, hitting each enemy exactly once', () => {
    const world = new World(8);
    grantWeapon(world, 'spear');

    const state = weaponState(world, 'spear');
    const damage = weaponDamage(SPEAR, state) * world.player.stats.damageMul;
    const queue = [30, 60, 90, 120].map((x) => placeEnemy(world, x, 0));
    rebuildGrid(world);

    weaponSystem(world, DT);

    for (const enemy of queue) {
      expect(enemy.hp).toBeCloseTo(DUMMY_HP - damage);
    }
  });

  /**
   * The projection onto the line is clamped to its ends, so the tip is a tip.
   * Without the clamp an enemy anywhere along the infinite line would be in
   * reach, and the reach upgrade would buy nothing.
   */
  it('stops at the tip', () => {
    const world = new World(9);
    grantWeapon(world, 'spear');

    const state = weaponState(world, 'spear');
    const reach = spearLength(SPEAR, state) + spearThickness(SPEAR, state) + ENEMY_RADIUS;
    // Something has to be in reach for the thrust to happen at all; this one
    // also fixes the direction the tip is measured along.
    placeEnemy(world, 20, 0);
    const inside = placeEnemy(world, reach - 2, 0);
    const outside = placeEnemy(world, reach + 2, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(inside.hp).toBeLessThan(DUMMY_HP);
    expect(outside.hp).toBe(DUMMY_HP);
  });

  /**
   * A thrust into nobody is not spent. The slowest weapon in the game would
   * otherwise burn its whole cooldown on empty ground and be on cooldown at
   * the exact moment the wave arrives.
   */
  it('holds the thrust while nothing is in reach', () => {
    const world = new World(10);
    grantWeapon(world, 'spear');

    const state = weaponState(world, 'spear');
    rebuildGrid(world);

    for (let tick = 0; tick < 30; tick++) weaponSystem(world, DT);
    expect(state.cooldown).toBeLessThanOrEqual(0);
    expect(state.swing).toBe(0);

    const arrival = placeEnemy(world, 40, 0);
    rebuildGrid(world);
    weaponSystem(world, DT);

    expect(arrival.hp).toBeLessThan(DUMMY_HP);
  });

  /** The lance is what the renderer draws; a thrust that shows nothing is a bug. */
  it('flags a thrust for the renderer and lets it expire', () => {
    const world = new World(11);
    grantWeapon(world, 'spear');
    placeEnemy(world, 40, 0);
    rebuildGrid(world);

    const state = weaponState(world, 'spear');
    weaponSystem(world, DT);
    expect(state.swing).toBe(SPEAR.swingTime);

    for (let tick = 0; tick < Math.ceil(SPEAR.swingTime / DT) + 1; tick++) {
      weaponSystem(world, DT);
    }
    expect(state.swing).toBe(0);
  });
});

/**
 * The world hands out an Auto Bolt on construction, so a harpoon test that
 * looked at `world.projectiles[0]` would be reading the bolt's shot. Colour is
 * how a projectile says which weapon fired it.
 */
function harpoonShots(world: World) {
  return world.projectiles.filter((projectile) => projectile.color === HARPOON.color);
}

/** Direction a shot was fired in, which is the only thing targeting decides. */
function shotAngle(world: World): number {
  const shots = harpoonShots(world);
  expect(shots).toHaveLength(1);
  return Math.atan2(shots[0].vy, shots[0].vx);
}

describe('siege harpoon', () => {
  /**
   * The rule the weapon exists for. Everything else in the game picks by
   * distance, so a harpoon that quietly fell back to nearest would still fire,
   * still hit, and simply stop being the answer to the thing it was added for.
   */
  it('spikes the heaviest enemy in range and not the nearest', () => {
    const world = new World(12);
    grantWeapon(world, 'harpoon');

    placeEnemy(world, 40, 0);
    const heavy = placeEnemy(world, 0, 200);
    heavy.hp = 900;
    heavy.maxHp = 900;
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(shotAngle(world)).toBeCloseTo(Math.PI / 2);
  });

  /**
   * Weight is `maxHp`, not what the target has left. A boss worked down below a
   * fresh grunt is still the body worth spending the slowest reload in the game
   * on, and reading current hp would walk the shot off it mid-duel.
   */
  it('keeps spiking a boss it has already worn down', () => {
    const world = new World(13);
    grantWeapon(world, 'harpoon');

    placeEnemy(world, 40, 0);
    const worn = placeEnemy(world, 0, 200);
    worn.maxHp = 900;
    worn.hp = 3;
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(shotAngle(world)).toBeCloseTo(Math.PI / 2);
  });

  /** Weight does not carry across the range check, or reach would be free. */
  it('ignores a heavier enemy beyond its range', () => {
    const world = new World(14);
    grantWeapon(world, 'harpoon');

    placeEnemy(world, 60, 0);
    const far = placeEnemy(world, 0, HARPOON.range + 40);
    far.hp = 5000;
    far.maxHp = 5000;
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(shotAngle(world)).toBeCloseTo(0);
  });

  /**
   * A dozen grunts from one spawn share their stats exactly, so without a
   * tie-break the pick would be whichever order the grid happened to return.
   */
  it('breaks a tie in weight toward the nearer body', () => {
    const world = new World(15);
    grantWeapon(world, 'harpoon');

    placeEnemy(world, 0, 300);
    placeEnemy(world, 90, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(shotAngle(world)).toBeCloseTo(0);
  });

  /**
   * Pierce is what makes the weapon pay for itself before the boss arrives, and
   * the stand priced it: without it the harpoon fells six bosses in twenty and
   * reaches only eight, with it ten and eleven. It also has to stay the
   * harpoon's and not leak into the bolt, which shares `fire`.
   */
  it('sends the spike through bodies, and leaves the bolt alone', () => {
    const world = new World(17);
    grantWeapon(world, 'harpoon');
    placeEnemy(world, 100, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(harpoonShots(world)[0].pierce).toBe(HARPOON.pierce);
    const bolts = world.projectiles.filter((shot) => shot.color !== HARPOON.color);
    expect(bolts).toHaveLength(1);
    expect(bolts[0].pierce).toBe(0);
  });

  /**
   * Two shots that differ only in colour are two shots that can look identical:
   * a frame cut from the sheet brings its own colour and is never tinted, so
   * the weapon's colour never reaches the screen. Shape is what survives that,
   * so the frame has to follow the weapon and not the pool the projectile was
   * taken from.
   */
  it('draws its shot with its own frame and leaves the bolt with the bolt', () => {
    const world = new World(18);
    grantWeapon(world, 'harpoon');
    placeEnemy(world, 100, 0);
    rebuildGrid(world);

    weaponSystem(world, DT);

    expect(harpoonShots(world)[0].sprite).toBe(HARPOON.sprite);
    expect(HARPOON.sprite).not.toBe(BOLT.sprite);
    const bolts = world.projectiles.filter((shot) => shot.color !== HARPOON.color);
    expect(bolts).toHaveLength(1);
    expect(bolts[0].sprite).toBe(BOLT.sprite);
  });

  /**
   * The longest reload in the game must not be halfway through itself when the
   * wave lands, so an empty field costs nothing.
   */
  it('holds the shot while the field is empty', () => {
    const world = new World(16);
    grantWeapon(world, 'harpoon');

    const state = weaponState(world, 'harpoon');
    rebuildGrid(world);

    for (let tick = 0; tick < 30; tick++) weaponSystem(world, DT);
    expect(harpoonShots(world)).toHaveLength(0);
    expect(state.cooldown).toBeLessThanOrEqual(0);

    placeEnemy(world, 100, 0);
    rebuildGrid(world);
    weaponSystem(world, DT);

    expect(harpoonShots(world)).toHaveLength(1);
  });
});

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
