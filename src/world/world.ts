import { CONFIG } from '../config';
import { Pool } from '../core/pool';
import { Rng } from '../core/rng';
import { SpatialGrid } from './grid';
import { STARTER_WEAPON_ID, createWeaponState, starterWeapon } from '../data/weapons';
import type { SpoilDef } from '../data/spoils';
import type { Chest, Effect, Enemy, Flame, Gem, Player, Projectile } from './types';

export type Phase = 'playing' | 'levelup' | 'chest' | 'paused' | 'dead';

/**
 * The phases a run can be paused from, and therefore returned to. A finished
 * run is already stopped, so pausing one would mean nothing.
 */
export type ResumablePhase = 'playing' | 'levelup' | 'chest';

/** Nobody is on the level-up screen. See `World.choosing`. */
export const NOBODY = -1;

/**
 * The entire game state. Deliberately free of any Pixi, DOM or timing import —
 * a `World` can be stepped in Node, which is what lets the simulation tests run
 * without a browser and what keeps rendering a pure read of this object.
 *
 * It holds a *list* of players, and that list is the seam between the field and
 * the people standing on it. The horde, the gems, the fire on the ground, the
 * clock and the run's PRNG are shared; everything that belongs to one person
 * lives on their `Player`. No system reaches for "the player" any more, which
 * is what makes four of them a matter of building the world differently rather
 * than of changing the rules.
 */
export class World {
  readonly seed: number;
  readonly rng: Rng;
  readonly grid = new SpatialGrid(CONFIG.grid.cellSize);

  readonly players: Player[] = [];
  readonly enemies: Enemy[] = [];
  readonly projectiles: Projectile[] = [];
  readonly gems: Gem[] = [];
  readonly effects: Effect[] = [];
  /** Burning ground the trail weapon has laid; see `trailSystem`. */
  readonly flames: Flame[] = [];

  readonly enemyPool = new Pool<Enemy>(createEnemy, 256);
  readonly projectilePool = new Pool<Projectile>(createProjectile, 128);
  readonly gemPool = new Pool<Gem>(createGem, 256);
  readonly effectPool = new Pool<Effect>(createEffect, 16);
  readonly flamePool = new Pool<Flame>(createFlame, 64);

  phase: Phase = 'playing';
  /**
   * Where to go when the pause lifts. Only meaningful while paused — pausing on
   * the level-up screen has to give the choice back rather than drop it.
   */
  resumeTo: ResumablePhase = 'playing';

  /**
   * Index of the player whose menu is up, or `NOBODY`.
   *
   * One field for both screens, because the phases are exclusive: 'levelup'
   * means they are picking a card and 'chest' means they are picking a spoil,
   * and either way somebody in particular is standing at a menu that has to
   * spend their level or heal their body.
   *
   * An index rather than a reference, so a world stays a plain bag of data that
   * could be serialised whole.
   */
  choosing: number = NOBODY;

  /** Elapsed run time in seconds. */
  time = 0;
  kills = 0;

  /**
   * The experience bar, and it is one bar for everybody.
   *
   * Levels are the run's rather than any player's: the bar fills from every gem
   * anybody collects, and when it fills *everyone still standing* gains a
   * level. What each of them then spends it on is their own — the cards, the
   * stacks and the weapons stay per player, which is where a party gets to be
   * four builds instead of four copies.
   *
   * The cost of a level scales with how many people are filling the bar, so a
   * pair take twice as long to level as a solo player and a four does four
   * times. Without that a party would be four times the collection rate against
   * a single-player curve, and would outrun the difficulty curve inside two
   * minutes. See `xpForNextLevel`, which derives the figure rather than storing
   * it — the share count changes when somebody falls, and a stored target would
   * be the thing that quietly went stale.
   */
  level = 1;
  xp = 0;

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
  /**
   * Run time at which the horde resumes during a duel.
   *
   * Only meaningful while `bossSpawned`. Set on arrival rather than derived
   * from it, because the fight has no other record of when it started.
   */
  hordeResumesAt = 0;

  /**
   * The chest waiting on the ground, or null when there is none.
   *
   * One at a time, by the type rather than by a rule somebody has to remember.
   * It never expires: the arrow on the HUD points at it until it is taken, so
   * it is a standing offer rather than something a player can be too slow for.
   *
   * One for the party rather than one each. A chest is a place worth crossing
   * the field for, and four of them on the ground would be four errands rather
   * than one decision — it would also quietly quadruple the reward rate.
   */
  chest: Chest | null = null;
  /** Seconds until the next chest is placed. Only counts down while there is none. */
  chestTimer: number = CONFIG.chest.firstAt;
  /** What the open chest is offering. Only meaningful while the phase is 'chest'. */
  spoils: SpoilDef[] = [];

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

  /**
   * `starters` is one weapon id per player, so its length is how many players
   * the run has. A bare `new World(seed)` is still a solo run opening with the
   * bolt, which is what every stand in this project measures.
   */
  constructor(seed: number, starters: string | readonly string[] = STARTER_WEAPON_ID) {
    this.seed = seed;
    this.rng = new Rng(seed);

    const ids = typeof starters === 'string' ? [starters] : starters;
    for (const id of ids) this.players.push(createPlayer(id));
  }

  nextDamageEvent(): number {
    return ++this.damageEvent;
  }
}

/**
 * One player, armed and standing at the origin.
 *
 * The weapon is resolved here so that nothing downstream has to cope with an id
 * that names none: the player would be granted nothing and stand there unarmed
 * while the horde arrived.
 */
function createPlayer(starterId: string): Player {
  const starter = starterWeapon(starterId);

  return {
    sprite: starter.playerSprite,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    hp: CONFIG.player.maxHp,
    invuln: 0,
    respawnAt: 0,
    watching: 0,
    stats: {
      maxHp: CONFIG.player.maxHp,
      moveSpeed: CONFIG.player.moveSpeed,
      damageMul: 1,
      attackSpeedMul: 1,
      pickupRadius: CONFIG.player.pickupRadius,
    },
    starterId: starter.id,
    intentX: 0,
    intentY: 0,
    moveTarget: null,
    headingX: 0,
    headingY: 0,
    weapons: [createWeaponState(starter.id)],
    pendingLevels: 0,
    offered: [],
    stacks: new Map<string, number>(),
    harvest: 0,
  };
}

function createEnemy(): Enemy {
  return {
    id: 0,
    defId: '',
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
    ability: '',
    abilityTimer: 0,
    standoff: 0,
    attackCooldown: 0,
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
    hostile: false,
    sprite: 'bolt',
  };
}

function createGem(): Gem {
  return { x: 0, y: 0, px: 0, py: 0, value: 1 };
}

function createFlame(): Flame {
  return { x: 0, y: 0, radius: 0, life: 0, maxLife: 1, color: 0xffffff };
}

function createEffect(): Effect {
  return { x: 0, y: 0, radius: 0, pradius: 0, maxRadius: 0, life: 0, maxLife: 1, color: 0xffffff };
}
