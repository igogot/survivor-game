/**
 * Every entity carries `px`/`py`: its position at the end of the previous tick.
 * The renderer interpolates between that and the current position so motion
 * stays smooth even though the simulation only advances 60 times per second.
 */

export interface PlayerStats {
  maxHp: number;
  moveSpeed: number;
  damageMul: number;
  attackSpeedMul: number;
  projectiles: number;
  pierce: number;
  pickupRadius: number;
}

export interface Player {
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
}

export interface Enemy {
  /** Stable per-spawn id; projectiles use it to avoid hitting the same target twice. */
  id: number;
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
