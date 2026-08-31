import type { SpriteName } from './sprites';
import type { WeaponState } from '../world/types';

/**
 * Weapons are data.
 *
 * `kind` selects which routine in src/systems/weapons.ts drives the weapon;
 * everything else on a definition is a number that can be retuned without
 * touching a system. The union is exhaustively switched over, so adding a
 * fourth kind makes the compiler point at every place that has to handle it.
 */
interface WeaponBase {
  readonly id: string;
  readonly name: string;
  /** Seconds between activations at 1.0x attack speed. */
  readonly cooldown: number;
  /** Damage at level 1, before the player's damage multiplier. */
  readonly damage: number;
  readonly damagePerLevel: number;
  readonly color: number;
  /**
   * The player's silhouette when a run opens with this weapon.
   *
   * On the definition rather than in a table beside it, for the same reason an
   * enemy carries its own sprite name: the picker, the world and the atlas all
   * have to agree about it, and a separate lookup is how they would stop.
   */
  readonly playerSprite: SpriteName;
}

/** Auto-aimed shots at the nearest enemy. The weapon a run opens with by default. */
export interface BoltWeaponDef extends WeaponBase {
  readonly kind: 'bolt';
  readonly projectileSpeed: number;
  readonly projectileRadius: number;
  /** Auto-aim only considers enemies within this distance. */
  readonly range: number;
  /** Projectile lifetime in seconds. */
  readonly life: number;
  /** Angle between adjacent projectiles when the player has more than one. */
  readonly spread: number;
}

/**
 * Blades circling the player.
 *
 * They never spawn or despawn — the ring is a function of one angle, so the
 * weapon costs zero entities. Damage lands in pulses rather than continuously,
 * which is what stops an enemy standing inside a blade from taking 60 hits a
 * second.
 *
 * A bodyguard, not a crowd-clearer. The ring covers the contact band and
 * nothing past it, so it is paid for in seconds survived rather than in kills;
 * the shockwave stays the weapon that thins a horde. Two invariants are what
 * make it worth a card at all, and the numbers below are chosen to hold them:
 *
 *   1. The band reaches the player's skin. An enemy touching the player stands
 *      at `player.radius + enemy.radius`, so `distance - orbRadius - enemy
 *      radius` has to stay under that. Otherwise the ring is a hoop around a
 *      hole, swinging at empty floor while something chews on the player
 *      inside it. Every upgrade used to widen that hole instead of closing it:
 *      levelling pushed the ring out and reach scaled the whole radius, so a
 *      fully bought ring dealt nothing at all within 95px of the player it was
 *      supposed to be guarding.
 *   2. The ring cannot skip. Damage is an instantaneous stamp at the pulse and
 *      not a swept arc, so the angle travelled between pulses (`spin *
 *      cooldown`) must stay under a blade's angular width (`2 * (orbRadius +
 *      enemy radius) / distance`). It did not: the ring turned 0.96 rad between
 *      bites while a blade covered 0.64, and two thirds of the horde walked
 *      through the gap between two samples untouched.
 */
export interface OrbitWeaponDef extends WeaponBase {
  readonly kind: 'orbit';
  readonly orbs: number;
  readonly orbsPerLevel: number;
  /** Distance from the player to the centre of each orb. */
  readonly distance: number;
  readonly distancePerLevel: number;
  readonly orbRadius: number;
  /** Radians per second. */
  readonly spin: number;
}

/**
 * A periodic burst of damage centred on the player.
 *
 * Pure crowd control, and the answer to the late-run problem the bolt cannot
 * solve: single-target damage does not scale with the size of the horde.
 */
export interface NovaWeaponDef extends WeaponBase {
  readonly kind: 'nova';
  readonly radius: number;
  readonly radiusPerLevel: number;
  /** Seconds the shockwave ring stays on screen. */
  readonly effectLife: number;
}

/**
 * A thrust that runs everyone standing behind the target through.
 *
 * The answer to the one thing the spawner already does on purpose:
 * `CONFIG.spawn.aheadBias` puts two thirds of every wave in the player's path,
 * so the nearest enemy is usually the front rank of a wall. The bolt picks that
 * wall apart one body at a time and the shockwave waits for it to arrive; the
 * spear opens it. Everything on the line is hit by one thrust, so a queue of
 * grunts costs the same as a single one.
 *
 * Piercing is not a stat here, it is the shape: the whole lance resolves as one
 * damage event, so every enemy along it is hit exactly once and none twice.
 *
 * Aimed at the nearest enemy, like every other weapon. An earlier version
 * pointed the lance along the player's smoothed heading instead, and the
 * balance stand cut it down: a survivor player drives *away* from the horde, so
 * the thrust kept landing in empty space and the run's kills nearly halved.
 * What the player steers here is reach, not aim.
 */
export interface SpearWeaponDef extends WeaponBase {
  readonly kind: 'spear';
  /** Reach of the thrust, measured from the player's centre. */
  readonly length: number;
  readonly lengthPerLevel: number;
  /** Half-width of the lance: how far off the line an enemy can stand. */
  readonly thickness: number;
  /** Seconds the lance stays on screen after a thrust. */
  readonly swingTime: number;
}

/**
 * One heavy spike, aimed by weight instead of by distance.
 *
 * Every other weapon answers the horde; this one answers the single body the
 * horde cannot replace. Its target is the largest `maxHp` in range rather than
 * the nearest — the only selector in the game that is not "nearest" — and it
 * reloads slower than anything else in the roster.
 *
 * Deliberately bad in a crowd. One shot every couple of seconds kills one grunt
 * and overkills it; that is what the damage costs, not an oversight. The gap it
 * fills is measured rather than felt: on twenty seeds the stand's best run of
 * `main` fells eight bosses, and nothing in the roster was built for one.
 */
export interface HarpoonWeaponDef extends WeaponBase {
  readonly kind: 'harpoon';
  readonly projectileSpeed: number;
  readonly projectileRadius: number;
  /** How far it looks for something worth spending a shot on. */
  readonly range: number;
  /** Projectile lifetime in seconds. */
  readonly life: number;
  /**
   * Bodies the spike passes through before it stops.
   *
   * Not flavour, and measured: without it the weapon fells a larger share of
   * the bosses it meets and reaches fewer of them, because the horde between
   * the player and minute ten does not care how hard one shot hits.
   */
  readonly pierce: number;
}

export type WeaponDef = BoltWeaponDef | OrbitWeaponDef | NovaWeaponDef | SpearWeaponDef | HarpoonWeaponDef;

export const BOLT: BoltWeaponDef = {
  kind: 'bolt',
  id: 'bolt',
  name: 'Auto Bolt',
  playerSprite: 'playerBolt',
  cooldown: 0.55,
  damage: 8,
  damagePerLevel: 0,
  color: 0x7fe7ff,
  projectileSpeed: 430,
  projectileRadius: 5,
  range: 430,
  life: 1.4,
  spread: 0.16,
};

export const ORBIT: OrbitWeaponDef = {
  kind: 'orbit',
  id: 'orbit',
  name: 'Orbit Blades',
  playerSprite: 'playerOrbit',
  cooldown: 0.22,
  damage: 10,
  damagePerLevel: 3,
  color: 0xffd166,
  orbs: 3,
  orbsPerLevel: 1,
  distance: 46,
  distancePerLevel: 0,
  orbRadius: 18,
  spin: 2.2,
};

export const NOVA: NovaWeaponDef = {
  kind: 'nova',
  id: 'nova',
  name: 'Shockwave',
  playerSprite: 'playerNova',
  cooldown: 2.2,
  damage: 14,
  damagePerLevel: 7,
  color: 0x9a7cff,
  radius: 112,
  radiusPerLevel: 22,
  effectLife: 0.32,
};

export const SPEAR: SpearWeaponDef = {
  kind: 'spear',
  id: 'spear',
  name: 'Lunge Spear',
  playerSprite: 'playerSpear',
  cooldown: 0.85,
  damage: 20,
  damagePerLevel: 8,
  color: 0xff9f6b,
  length: 132,
  lengthPerLevel: 20,
  thickness: 13,
  swingTime: 0.13,
};

export const HARPOON: HarpoonWeaponDef = {
  kind: 'harpoon',
  id: 'harpoon',
  name: 'Siege Harpoon',
  playerSprite: 'playerHarpoon',
  // The longest reload in the game, and the longest reach. Both are the shape
  // of the weapon: it is not meant to be firing when there is nothing worth
  // firing at, and the caster stands off at 240 where nothing else reaches.
  cooldown: 2.4,
  damage: 70,
  damagePerLevel: 26,
  color: 0x6ef2a4,
  projectileSpeed: 620,
  projectileRadius: 9,
  range: 520,
  // Enough flight to cover the range with room for a target that moved, on the
  // same ratio the bolt uses.
  life: 1.2,
  pierce: 5,
};

export const WEAPONS: readonly WeaponDef[] = [BOLT, ORBIT, NOVA, SPEAR, HARPOON];

const BY_ID = new Map<string, WeaponDef>(WEAPONS.map((def) => [def.id, def]));

/** Returns `undefined` for an unknown id rather than throwing — callers skip it. */
export function weaponById(id: string): WeaponDef | undefined {
  return BY_ID.get(id);
}

/**
 * What a run opens with when nobody chose — a headless run, a harness, a test.
 *
 * The bolt, because it is the only weapon that reaches across the screen and
 * so the only one that can be played badly and still teach the game.
 */
export const STARTER_WEAPON_ID = BOLT.id;

/**
 * The weapon a run should open with, given whatever the caller was told.
 *
 * Takes anything and answers with a real definition. The id reaches the world
 * from a picker built out of `WEAPONS`, so it is always valid — but a saved
 * link, a typo in a query string or a weapon deleted between releases must
 * open a run with the starter rather than one with no weapon at all, which is
 * unplayable and looks like the game is broken.
 */
export function starterWeapon(id: string | null | undefined): WeaponDef {
  const chosen = id === null || id === undefined ? undefined : BY_ID.get(id);
  return chosen ?? BOLT;
}

/*
 * Level scaling lives here rather than in the systems because the renderer
 * needs the same numbers: the orbs it draws must sit exactly where the damage
 * pulse looked for enemies.
 */

/*
 * Each of these takes the weapon's state rather than its level, so a per-weapon
 * modifier cannot be applied in one caller and forgotten in another. That
 * mattered immediately: the renderer places the orbs and the weapon system
 * looks for enemies under them, and the two reading different numbers is the
 * exact failure this file already warns about.
 */

export function weaponDamage(def: WeaponDef, state: WeaponState): number {
  return (def.damage + def.damagePerLevel * (state.level - 1)) * state.damageMul;
}

/** Seconds until the next activation, given the player's global attack speed. */
export function weaponCooldown(def: WeaponDef, state: WeaponState, attackSpeedMul: number): number {
  return def.cooldown / (attackSpeedMul * state.attackSpeedMul);
}

/**
 * How much of Long Reach's bonus pushes the ring outward; the rest thickens the
 * blades.
 *
 * Reach used to scale ring and blade alike, which carried the guard away from
 * whatever had just closed to arm's length — the upgrade made the weapon worse
 * at its only job. Spending it mostly on the blade widens the band inward and
 * outward at once instead.
 */
const REACH_PUSH = 0.3;

export function orbitCount(def: OrbitWeaponDef, state: WeaponState): number {
  return def.orbs + def.orbsPerLevel * (state.level - 1);
}

export function orbitDistance(def: OrbitWeaponDef, state: WeaponState): number {
  return (def.distance + def.distancePerLevel * (state.level - 1)) * (1 + (state.areaMul - 1) * REACH_PUSH);
}

/** Radians per second. Turning faster is half of what Whirling Edge buys. */
export function orbitSpin(def: OrbitWeaponDef, state: WeaponState): number {
  return def.spin * state.spinMul;
}

/** Blades grow with reach, so a wider ring does not thin out into a sieve. */
export function orbitRadius(def: OrbitWeaponDef, state: WeaponState): number {
  return def.orbRadius * state.areaMul;
}

export function spearLength(def: SpearWeaponDef, state: WeaponState): number {
  return (def.length + def.lengthPerLevel * (state.level - 1)) * state.areaMul;
}

/** Half-width of the lance. Reach widens the line as well as lengthening it. */
export function spearThickness(def: SpearWeaponDef, state: WeaponState): number {
  return def.thickness * state.areaMul;
}

export function novaRadius(def: NovaWeaponDef, state: WeaponState): number {
  return (def.radius + def.radiusPerLevel * (state.level - 1)) * state.areaMul;
}

/**
 * A weapon's runtime state. Lives here beside the definition so that both the
 * world (which grants the starter weapon) and the weapon system (which grants
 * the rest) build it the same way, with no import cycle between them.
 */
export function createWeaponState(defId: string): WeaponState {
  // Zero cooldown: a newly granted weapon fires on the tick it is picked, which
  // is the immediate feedback the level-up screen implicitly promises.
  return {
    defId,
    level: 1,
    cooldown: 0,
    angle: 0,
    pangle: 0,
    damageMul: 1,
    attackSpeedMul: 1,
    areaMul: 1,
    projectiles: 1,
    pierce: 0,
    spinMul: 1,
    swing: 0,
  };
}
