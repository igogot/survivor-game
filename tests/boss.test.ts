import { describe, expect, it } from 'vitest';
import { BOSS } from '../src/data/enemies';
import { BOSS_ABILITIES, bossAbility } from '../src/data/bossAbilities';
import { CONFIG } from '../src/config';
import { applyDamage } from '../src/systems/damage';
import { bossAbilitySystem } from '../src/systems/bossAbility';
import { spawnEnemyAt } from '../src/systems/spawn';
import { World } from '../src/world/world';
import type { BossAbilityId } from '../src/data/bossAbilities';
import type { Enemy } from '../src/world/types';

/**
 * Ten bosses, ten fights.
 *
 * The promise the feature is built on is that a player meets every trick once
 * before meeting any of them twice, and it is a promise about a rotation rather
 * than about a draw — so it is checkable exactly, not statistically.
 */

const DT = 1 / CONFIG.tickRate;

/** A boss carrying the ability the nth duel would bring, at an exact spot. */
function placeBoss(world: World, index: number, x: number, y: number): Enemy {
  world.bossesKilled = index;
  spawnEnemyAt(world, BOSS, 1, x, y);
  const boss = world.enemies[world.enemies.length - 1];
  expect(boss.boss).toBe(true);
  return boss;
}

/**
 * Runs the ability system for a while, in the same steps the world would.
 *
 * A shade past whatever it is asked for, so a cooldown that lands exactly on a
 * tick boundary is not a coin toss between two floating-point sums.
 */
function tick(world: World, seconds: number): void {
  const steps = Math.round(seconds / DT) + 1;
  for (let i = 0; i < steps; i++) bossAbilitySystem(world, DT);
}

function hostileShots(world: World) {
  return world.projectiles.filter((projectile) => projectile.hostile);
}

describe('the rotation', () => {
  it('gives the first ten bosses ten different abilities', () => {
    const first = Array.from({ length: 10 }, (_, index) => bossAbility(index).id);

    expect(first).toHaveLength(10);
    expect(new Set(first).size, 'a trick repeats inside the first ten').toBe(10);
  });

  it('has exactly ten to rotate through', () => {
    expect(BOSS_ABILITIES).toHaveLength(10);
    expect(new Set(BOSS_ABILITIES.map((ability) => ability.id)).size).toBe(10);
  });

  it('starts over on the eleventh, against a boss with ten times the health', () => {
    expect(bossAbility(10).id).toBe(bossAbility(0).id);
    expect(bossAbility(23).id).toBe(bossAbility(3).id);
  });

  it('hands the arriving boss the ability its number calls for', () => {
    const world = new World(5);
    for (let index = 0; index < 10; index++) {
      const boss = placeBoss(world, index, 400 + index * 50, 0);
      expect(boss.ability, `boss ${index}`).toBe(bossAbility(index).id);
    }
  });

  /**
   * A passive with a cooldown would be used every tick, and an active without
   * one would be used every tick too. Both are the same bug written twice.
   */
  it('gives every active a cooldown and every passive none', () => {
    for (const ability of BOSS_ABILITIES) {
      if (ability.kind === 'active') expect(ability.cooldown, ability.id).toBeGreaterThan(0);
      else expect(ability.cooldown, ability.id).toBe(0);
      expect(ability.power, ability.id).toBeGreaterThan(0);
    }
  });
});

/** The index in the rotation that carries one ability, for the tests below. */
function indexOf(id: BossAbilityId): number {
  const found = BOSS_ABILITIES.findIndex((ability) => ability.id === id);
  expect(found, `no ${id} in the rotation`).toBeGreaterThanOrEqual(0);
  return found;
}

describe('what each boss does', () => {
  it('charges faster than it walks, and stops charging', () => {
    const world = new World(5);
    const ability = bossAbility(indexOf('charge'));
    const boss = placeBoss(world, indexOf('charge'), 300, 0);

    tick(world, ability.cooldown);
    expect(boss.speed).toBeCloseTo(BOSS.speed * ability.power, 5);

    tick(world, ability.duration);
    expect(boss.speed).toBeCloseTo(BOSS.speed, 5);
  });

  it('calls bodies to it', () => {
    const world = new World(5);
    const ability = bossAbility(indexOf('summon'));
    placeBoss(world, indexOf('summon'), 300, 0);
    const before = world.enemies.length;

    tick(world, ability.cooldown);

    expect(world.enemies.length).toBe(before + ability.power);
  });

  it('throws a volley at somebody and a burst at nobody', () => {
    const aimed = new World(5);
    const volley = bossAbility(indexOf('volley'));
    // Placed off the x axis on purpose: shots aimed along it come back from
    // `atan2` as +π and −π, and a fan measured across that seam looks like a
    // ring. The seam is the test's problem, not the weapon's.
    placeBoss(aimed, indexOf('volley'), 0, -300);
    tick(aimed, volley.cooldown);

    const shots = hostileShots(aimed);
    expect(shots).toHaveLength(volley.power);
    const angles = shots.map((shot) => Math.atan2(shot.vy, shot.vx));
    // All of them within a narrow fan: one aimed attack, not three.
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(0.6);

    const ring = new World(5);
    const burst = bossAbility(indexOf('burst'));
    placeBoss(ring, indexOf('burst'), 0, -300);
    tick(ring, burst.cooldown);

    const around = hostileShots(ring);
    expect(around).toHaveLength(burst.power);
    // A ring is read as a ring rather than by its angles: shots spread evenly
    // around the compass cancel out, and a fan does not come close.
    const sumX = around.reduce((sum, shot) => sum + shot.vx, 0);
    const sumY = around.reduce((sum, shot) => sum + shot.vy, 0);
    const speed = Math.hypot(around[0].vx, around[0].vy);
    expect(Math.hypot(sumX, sumY)).toBeLessThan(speed * 0.05);
  });

  it('quakes the ground under whoever is close, and not whoever is not', () => {
    const near = new World(5);
    const ability = bossAbility(indexOf('quake'));
    placeBoss(near, indexOf('quake'), 40, 0);
    const hp = near.players[0].hp;
    tick(near, ability.cooldown);
    expect(near.players[0].hp).toBeLessThan(hp);

    const far = new World(5);
    placeBoss(far, indexOf('quake'), 900, 0);
    const untouched = far.players[0].hp;
    tick(far, ability.cooldown);
    expect(far.players[0].hp).toBe(untouched);
  });

  it('is faster the closer it is to dying', () => {
    const world = new World(5);
    const boss = placeBoss(world, indexOf('enrage'), 300, 0);

    tick(world, DT);
    const whole = boss.speed;

    boss.hp = boss.maxHp * 0.1;
    tick(world, DT);

    expect(boss.speed).toBeGreaterThan(whole);
  });

  it('feeds while it is touching somebody, and starves at range', () => {
    const close = new World(5);
    const boss = placeBoss(close, indexOf('leech'), CONFIG.player.radius + BOSS.radius - 2, 0);
    boss.hp = boss.maxHp * 0.5;
    const hurt = boss.hp;
    tick(close, 1);
    expect(boss.hp).toBeGreaterThan(hurt);

    const away = new World(5);
    const distant = placeBoss(away, indexOf('leech'), 600, 0);
    distant.hp = distant.maxHp * 0.5;
    const held = distant.hp;
    tick(away, 1);
    expect(distant.hp).toBe(held);
  });

  it('blinks to arm’s length rather than on top of anybody', () => {
    const world = new World(5);
    const ability = bossAbility(indexOf('blink'));
    const boss = placeBoss(world, indexOf('blink'), 900, 0);

    tick(world, ability.cooldown);

    const player = world.players[0];
    const gap = Math.hypot(boss.x - player.x, boss.y - player.y);
    // Outside touching range, and only just.
    expect(gap).toBeGreaterThan(BOSS.radius + CONFIG.player.radius);
    expect(gap).toBeCloseTo(BOSS.radius + CONFIG.player.radius + ability.power, 5);
    // No interpolated sprint across the screen on the frame it moves.
    expect(boss.px).toBe(boss.x);
  });

  it('shrugs off damage while warded and takes it when the window closes', () => {
    const world = new World(5);
    const ability = bossAbility(indexOf('ward'));
    const boss = placeBoss(world, indexOf('ward'), 300, 0);

    // Before the first use there is no window: a warded boss is an ordinary one.
    const full = boss.hp;
    applyDamage(world, boss, 100);
    expect(full - boss.hp).toBeCloseTo(100, 5);

    tick(world, ability.cooldown);
    expect(boss.abilityTimer).toBeGreaterThan(0);

    const warded = boss.hp;
    applyDamage(world, boss, 100);
    expect(warded - boss.hp).toBeCloseTo(100 * ability.power, 5);
  });

  it('sends a share of every hit back', () => {
    const world = new World(5);
    const ability = bossAbility(indexOf('thorns'));
    const boss = placeBoss(world, indexOf('thorns'), 300, 0);
    const player = world.players[0];
    const hp = player.hp;

    // Small enough that the share is under the cap and the share is what lands.
    applyDamage(world, boss, 50);

    expect(player.hp).toBeCloseTo(hp - 50 * ability.power, 5);
    // Reflected through the same window a body's hit uses, so a fast weapon
    // cannot return a whole volley at once.
    expect(player.invuln).toBeGreaterThan(0);
  });

  /**
   * The reflection is a share of a number that grows all run — a harpoon at
   * minute ninety lands for thousands. Uncapped, the tenth boss would not be a
   * hard fight but an execution, and the cap is what makes the ability
   * shippable rather than a joke about big numbers.
   */
  it('caps what a reflection can take, however hard the player hits', () => {
    const world = new World(5);
    const boss = placeBoss(world, indexOf('thorns'), 300, 0);
    const player = world.players[0];
    const hp = player.hp;

    applyDamage(world, boss, 100000);

    const taken = hp - player.hp;
    expect(taken).toBeGreaterThan(0);
    expect(taken, 'an uncapped reflection').toBeLessThan(player.stats.maxHp * 0.2);
  });

  /**
   * The blunder this exists to make impossible: `power` for the quake is
   * damage, and it sat at 190 for a while — which is the radius, and which
   * against a hundred points of health was not an ability but an instant loss
   * every six seconds.
   */
  it('never kills a player at full health with one use', () => {
    for (const ability of BOSS_ABILITIES) {
      const world = new World(5);
      // Right on top of the player, which is the worst case for every one of
      // them, and long enough for several uses.
      const boss = placeBoss(world, indexOf(ability.id), 20, 0);
      const player = world.players[0];
      player.hp = player.stats.maxHp;

      tick(world, ability.cooldown);

      expect(player.hp, `${ability.id} emptied a full bar in one use`).toBeGreaterThan(0);
      expect(boss.hp).toBeGreaterThan(0);
    }
  });

  /**
   * The one thing no ability may do. A draw here would move every seed in the
   * balance table, and the table is how this project knows anything.
   */
  it('spends nothing from the run’s generator', () => {
    const world = new World(5);

    for (let index = 0; index < BOSS_ABILITIES.length; index++) {
      const fresh = new World(5);
      placeBoss(fresh, index, 200, 0);
      const before = fresh.rng.next();

      const again = new World(5);
      placeBoss(again, index, 200, 0);
      tick(again, 20);

      expect(again.rng.next(), BOSS_ABILITIES[index].id).toBe(before);
    }

    expect(world.enemies).toHaveLength(0);
  });
});
