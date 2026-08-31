import { CONFIG } from '../config';
import { Pool } from '../core/pool';
import { Rng } from '../core/rng';
import { SpatialGrid } from './grid';
import { STARTER_WEAPON_ID, createWeaponState } from '../data/weapons';
import { xpForLevel } from '../systems/progression';
import type { UpgradeDef } from '../data/upgrades';
import type { Effect, Enemy, Gem, Player, Projectile, WeaponState } from './types';

export type Phase = 'playing' | 'levelup' | 'paused' | 'dead';

/**
 * The phases a run can be paused from, and therefore returned to. A finished
 * run is already stopped, so pausing one would mean nothing.
 */
export type ResumablePhase = 'playing' | 'levelup';

/**
 * The entire game state. Deliberately free of any Pixi, DOM or timing import —
 * a `World` can be stepped in Node, which is what lets the simulation tests run
 * without a browser and what keeps rendering a pure read of this object.
 */
export class World {
  readonly seed: number;
  readonly rng: Rng;
  readonly grid = new SpatialGrid(CONFIG.grid.cellSize);

  readonly player: Player;
  readonly enemies: Enemy[] = [];
  readonly projectiles: Projectile[] = [];
  readonly gems: Gem[] = [];
  readonly effects: Effect[] = [];

  readonly enemyPool = new Pool<Enemy>(createEnemy, 256);
  readonly projectilePool = new Pool<Projectile>(createProjectile, 128);
  readonly gemPool = new Pool<Gem>(createGem, 256);
  readonly effectPool = new Pool<Effect>(createEffect, 16);

  /** Weapons the player owns, in the order they were acquired. */
  readonly weapons: WeaponState[] = [];

  phase: Phase = 'playing';
  /**
   * Where to go when the pause lifts. Only meaningful while paused — pausing on
   * the level-up screen has to give the choice back rather than drop it.
   */
  resumeTo: ResumablePhase = 'playing';
  /** Elapsed run time in seconds. */
  time = 0;
  kills = 0;

  /** Movement intent for this tick, written by the input layer or a test. */
  intentX = 0;
  intentY = 0;

  /**
   * Smoothed movement direction. The spawner reads it to put enemies in the
   * player's path, so it has to survive the player tapping a key for one tick.
   */
  headingX = 0;
  headingY = 0;

  spawnTimer = 0;
  /** Whether a boss is on the field right now. Cleared when it dies. */
  bossSpawned = false;
  /** Bosses felled this run. Sets the next one's HP and scores the run. */
  bossesKilled = 0;
  /**
   * Run time at which the next boss arrives.
   *
   * A deadline rather than `time % interval`, because the duel itself takes
   * time: the next boss is due an interval after the last one *died*, not an
   * interval after it spawned.
   */
  // Annotated: `CONFIG` is `as const`, so inference would pin this to the
  // literal 600 and refuse every later assignment.
  nextBossAt: number = CONFIG.boss.interval;

  /** Levels gained but not yet spent on an upgrade. */
  pendingLevels = 0;
  offered: UpgradeDef[] = [];
  readonly stacks = new Map<string, number>();

  nextEntityId = 1;

  /**
   * Monotonic counter stamped onto every enemy an area attack hits. See
   * `Enemy.hitTag` — it is what makes one shockwave deal its damage once even
   * though it resolves through several overlapping queries.
   */
  private damageEvent = 0;

  /**
   * Shared scratch buffer for broad-phase queries. Reused by every system so a
   * tick performs no array allocation at all.
   */
  readonly scratch: number[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.player = {
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      hp: CONFIG.player.maxHp,
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(1),
      invuln: 0,
      stats: {
        maxHp: CONFIG.player.maxHp,
        moveSpeed: CONFIG.player.moveSpeed,
        damageMul: 1,
        attackSpeedMul: 1,
        pickupRadius: CONFIG.player.pickupRadius,
      },
    };

    this.weapons.push(createWeaponState(STARTER_WEAPON_ID));
  }

  nextDamageEvent(): number {
    return ++this.damageEvent;
  }
}

function createEnemy(): Enemy {
  return {
    id: 0,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    hp: 1,
    maxHp: 1,
    speed: 0,
    damage: 0,
    radius: 1,
    xpValue: 0,
    color: 0xffffff,
    sprite: 'grunt',
    flash: 0,
    hitTag: 0,
    boss: false,
  };
}

function createProjectile(): Projectile {
  return {
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    damage: 0,
    radius: 1,
    life: 0,
    pierce: 0,
    lastHitId: 0,
    color: 0xffffff,
  };
}

function createGem(): Gem {
  return { x: 0, y: 0, px: 0, py: 0, value: 1 };
}

function createEffect(): Effect {
  return { x: 0, y: 0, radius: 0, pradius: 0, maxRadius: 0, life: 0, maxLife: 1, color: 0xffffff };
}
