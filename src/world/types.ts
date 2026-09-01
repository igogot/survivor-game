import type { SpriteName } from '../data/sprites';
import type { UpgradeDef } from '../data/upgrades';

/**
 * Every entity carries `px`/`py`: its position at the end of the previous tick.
 * The renderer interpolates between that and the current position so motion
 * stays smooth even though the simulation only advances 60 times per second.
 */

/**
 * A place on the ground the player was told to walk to, in world units.
 *
 * Not an entity: it has no size, nothing collides with it and it never moves.
 * It is one standing instruction, and the tick that fulfils it drops it.
 */
export interface MoveTarget {
  x: number;
  y: number;
}

/**
 * A chest waiting to be walked into, in world units.
 *
 * The only thing in the game that stays where it was put. It carries no
 * `px`/`py` because it never moves, and no contents because what is inside is
 * rolled when it is opened rather than when it is placed — a chest the player
 * can see is a chest whose spoils have not been decided yet, which is what
 * stops the same seed from being read off the arrow.
 */
export interface Chest {
  x: number;
  y: number;
}

export interface PlayerStats {
  maxHp: number;
  moveSpeed: number;
  damageMul: number;
  attackSpeedMul: number;
  pickupRadius: number;
}

/**
 * One player.
 *
 * Everything a player is now lives here rather than on the world, including
 * the things that used to look global because there was only ever one of them:
 * the intent driving them this tick, the heading the spawner reads, the
 * standing move order, the weapons they carry and the levels they have yet to
 * spend. A world holds a list of these, and the systems loop.
 *
 * The split is the whole point. `World` is the shared field — the horde, the
 * gems, the fire on the ground, the clock and the run's PRNG — and a `Player`
 * is one participant in it. Nothing outside this interface should have to know
 * how many participants there are.
 */
export interface Player {
  /**
   * Which figure the player is, decided by the weapon the run opened with.
   *
   * On the entity like an enemy's, so the renderer stays a pure read of world
   * state and a run that started as a wizard is still a wizard after a
   * restart, a pause or a reload.
   */
  sprite: SpriteName;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** Seconds of invulnerability left after the last hit. */
  invuln: number;
  stats: PlayerStats;

  /** The weapon this player's run opened with. */
  readonly starterId: string;

  /** Movement intent for this tick, written by the input layer or a test. */
  intentX: number;
  intentY: number;

  /**
   * Where a click told this player to walk, or null when nobody has ordered
   * one.
   *
   * Kept beside the intent rather than folded into it because the two answer
   * different questions: the intent is this tick, the order outlives it. The
   * steering system turns one into the other, and a hand on the keys cancels
   * it — see `steeringSystem`.
   */
  moveTarget: MoveTarget | null;

  /**
   * Smoothed movement direction. The spawner reads it to put enemies in the
   * player's path, so it has to survive them tapping a key for one tick.
   */
  headingX: number;
  headingY: number;

  /** Weapons this player owns, in the order they were acquired. */
  readonly weapons: WeaponState[];

  /** Levels gained but not yet spent on an upgrade. */
  pendingLevels: number;
  offered: UpgradeDef[];
  readonly stacks: Map<string, number>;

  /**
   * Seconds left on a harvest, the spoil that drags every gem in range home.
   *
   * On the player rather than on the run, which is a change of mind the party
   * forced. With one player the distinction was invisible and "not a stat"
   * was reason enough to keep it on the world. With four it is the whole
   * question: a chest is spent by one person, and a harvest that paid out for
   * everybody would be worth four times what it costs.
   */
  harvest: number;
}

export interface Enemy {
  /** Stable per-spawn id; projectiles use it to avoid hitting the same target twice. */
  id: number;
  /**
   * Distance this enemy tries to keep from the player. 0 for everything that
   * attacks by walking into them.
   */
  standoff: number;
  /** Seconds until this enemy may attack again. Only used when it can. */
  attackCooldown: number;
  /**
   * Which `EnemyDef` produced this one.
   *
   * The entity carries numbers rather than a reference to its definition, so
   * this string is how death gets back to it — `reapSystem` needs to know what
   * a splitter leaves behind.
   */
  defId: string;
  x: number;
  y: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  radius: number;
  xpValue: number;
  color: number;
  sprite: SpriteName;
  /** Seconds of hit-flash left. Purely cosmetic, but it lives on the entity so
   *  the renderer stays a pure function of world state. */
  flash: number;
  /**
   * Id of the last area-damage event that hit this enemy.
   *
   * A shockwave or a ring of blades resolves as one event: every enemy it
   * touches is stamped with the event id and skipped if it is already stamped.
   * Ids only ever increase, so a recycled enemy can never carry a stamp that
   * matches a future event, and nothing has to be cleared between pulses.
   */
  hitTag: number;
  boss: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  /** Remaining enemies this projectile may pass through. */
  pierce: number;
  /** Last enemy hit, so a piercing shot cannot re-hit it next tick. */
  lastHitId: number;
  color: number;
  /**
   * Whose shot this is.
   *
   * The horde and the player share one pool and one system rather than two of
   * each: everything about a projectile except who it looks for is identical,
   * and a second copy of the movement and lifetime code is exactly where the
   * two would drift apart.
   */
  hostile: boolean;
  /**
   * Which frame the renderer draws, the same way `Enemy.sprite` works.
   *
   * A hex must not look like the player's bolt, and colour cannot carry that
   * distinction: a frame cut from the sheet is not tinted at all, because it
   * brings its own colour — see `TextureSet.masked`. Shape is what survives
   * the swap, so whoever fires says what the shot looks like.
   */
  sprite: SpriteName;
}

export interface Gem {
  x: number;
  y: number;
  px: number;
  py: number;
  value: number;
}

/**
 * One weapon the player owns, plus its runtime state.
 *
 * `angle` is only meaningful for orbiting weapons, but keeping the state shape
 * flat avoids a second union that every consumer would have to narrow. It
 * carries a previous value for the same reason entities carry `px`/`py`: the
 * renderer interpolates it.
 */
export interface WeaponState {
  readonly defId: string;
  level: number;
  /** Seconds until the next activation. */
  cooldown: number;
  angle: number;
  pangle: number;
  /**
   * Modifiers raised by upgrades that name this weapon.
   *
   * `PlayerStats` multiplies every weapon the player owns; these multiply
   * exactly one. That split is what makes investing in a specific weapon
   * possible, and it is the whole point of the distinction.
   */
  damageMul: number;
  attackSpeedMul: number;
  /** Scales the weapon's footprint: orbit reach and blade size, nova radius. */
  areaMul: number;
  /**
   * Bolt-only, the same way `angle` and `pangle` are orbit-only. Both were
   * player stats until it became clear that nothing but the bolt ever read
   * them, which made them look global while behaving otherwise.
   */
  projectiles: number;
  pierce: number;
  /**
   * Orbit-only: how fast the ring turns. Separate from `attackSpeedMul`, which
   * is how often it bites, because an upgrade moves both and the renderer reads
   * only this one.
   */
  spinMul: number;
  /**
   * Seconds left of the thrust the spear is showing.
   *
   * The lance has no entity behind it: it is drawn from this and `angle`, the
   * same two numbers the damage used, so it cannot be drawn anywhere other
   * than where it hit.
   */
  swing: number;
  /**
   * Trail-only: where the last patch of fire was laid.
   *
   * A position rather than a timer, because the trail is laid by distance
   * covered and not on a clock — that is what makes the ribbon continuous at
   * any speed, and what makes standing still lay nothing at all.
   */
  trailX: number;
  trailY: number;
}

/**
 * One patch of burning ground.
 *
 * The only entity in the game that never moves and is not attached to
 * anything: it is laid where the player passed and it stays there until it
 * burns out. That is why it carries no `px`/`py` — there is nothing for the
 * renderer to interpolate between.
 *
 * It carries its own `radius` and `color` rather than reading them back off
 * the weapon, so a patch is what the weapon was when it laid it. Levelling the
 * trail mid-run widens the next patch and leaves the ones already on the
 * ground alone, which is both the honest behaviour and what keeps the renderer
 * a pure read of world state.
 */
export interface Flame {
  x: number;
  y: number;
  radius: number;
  /** Seconds of burning left. */
  life: number;
  /** What `life` started at, so the renderer can fade the patch out. */
  maxLife: number;
  color: number;
}

/**
 * A purely cosmetic, self-expiring shape — currently the shockwave ring.
 *
 * Effects live in the world rather than in the renderer so that rendering stays
 * a read-only projection of simulation state, and so a headless run behaves
 * identically to one with a canvas attached.
 */
export interface Effect {
  x: number;
  y: number;
  radius: number;
  pradius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: number;
}
