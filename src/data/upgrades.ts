import type { PlayerStats, WeaponState } from '../world/types';

interface UpgradeBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** How many times this upgrade may be taken in one run. `Infinity` for the tail. */
  readonly maxStacks: number;
  /**
   * Held back until the designed pool can no longer fill a level-up menu.
   *
   * The thirteen designed upgrades total fifty stacks, so a run that reaches
   * level 51 spends the last one and every level after it is worth nothing —
   * `progressionSystem` used to swallow them silently. That is unreachable in a
   * ten-minute run and routine in a long one: a bot left to survive past the
   * boss hit the cap at 51 and took twenty-three more levels for no reward.
   *
   * Kept out of the roll entirely until then rather than mixed in and made
   * rare. A bigger pool makes every designed card rarer, including the ones a
   * run is actually built on, and the balance stand has caught that before —
   * see the note on `OFFERS_PER_LEVEL`.
   */
  readonly fallback?: boolean;
}

/**
 * Mutates the player's stat block and nothing else. Keeping these as pure stat
 * transforms is what makes them trivially testable — see
 * tests/progression.test.ts.
 */
export interface StatUpgradeDef extends UpgradeBase {
  readonly kind: 'stat';
  readonly apply: (stats: PlayerStats) => void;
}

/**
 * Grants a weapon on the first take and levels it on every later one.
 *
 * It names a weapon instead of carrying a function so that the progression
 * system never learns what a weapon is: it hands the id to the weapon system
 * and stays a pure "spend a level, record a stack" loop.
 */
export interface WeaponUpgradeDef extends UpgradeBase {
  readonly kind: 'weapon';
  readonly weaponId: string;
}

/**
 * Modifies one weapon the player already owns.
 *
 * The distinction from `StatUpgradeDef` is the point: a stat upgrade multiplies
 * every weapon, this multiplies exactly one. Without it the only way to invest
 * in a weapon is to re-take it, which caps out, and the run collapses into a
 * single viable build.
 *
 * Offered only while `weaponId` is owned — see `rollUpgrades`.
 */
export interface WeaponModUpgradeDef extends UpgradeBase {
  readonly kind: 'weaponMod';
  readonly weaponId: string;
  readonly apply: (state: WeaponState) => void;
}

export type UpgradeDef = StatUpgradeDef | WeaponUpgradeDef | WeaponModUpgradeDef;

export const UPGRADES: readonly UpgradeDef[] = [
  {
    kind: 'weapon',
    id: 'orbit',
    weaponId: 'orbit',
    name: 'Orbit Blades',
    description: 'Blades circle you and cut what they touch. +1 blade per level',
    maxStacks: 4,
  },
  {
    kind: 'weapon',
    id: 'nova',
    weaponId: 'nova',
    name: 'Shockwave',
    description: 'A burst of damage around you every few seconds. +damage and radius',
    maxStacks: 4,
  },
  {
    kind: 'stat',
    id: 'damage',
    name: 'Whetstone',
    description: '+25% damage',
    maxStacks: 5,
    apply: (stats) => {
      stats.damageMul += 0.25;
    },
  },
  {
    kind: 'stat',
    id: 'haste',
    name: 'Quick Hands',
    description: '+20% attack speed',
    maxStacks: 5,
    apply: (stats) => {
      stats.attackSpeedMul += 0.2;
    },
  },
  {
    kind: 'stat',
    id: 'boots',
    name: 'Light Boots',
    description: '+12% move speed',
    maxStacks: 4,
    apply: (stats) => {
      stats.moveSpeed *= 1.12;
    },
  },
  {
    kind: 'weaponMod',
    id: 'multishot',
    weaponId: 'bolt',
    name: 'Split Shot',
    description: 'Auto Bolt fires +1 projectile',
    maxStacks: 4,
    apply: (weapon) => {
      weapon.projectiles += 1;
    },
  },
  {
    kind: 'weaponMod',
    id: 'pierce',
    weaponId: 'bolt',
    name: 'Piercing Tip',
    description: 'Auto Bolt pierces one more enemy',
    maxStacks: 3,
    apply: (weapon) => {
      weapon.pierce += 1;
    },
  },
  {
    kind: 'weaponMod',
    id: 'orbit-reach',
    weaponId: 'orbit',
    name: 'Long Reach',
    description: 'Orbit Blades swing wider, and the blades grow with the ring',
    maxStacks: 3,
    apply: (weapon) => {
      weapon.areaMul += 0.18;
    },
  },
  {
    kind: 'weaponMod',
    id: 'nova-blast',
    weaponId: 'nova',
    name: 'Wide Blast',
    description: 'Shockwave covers more ground',
    maxStacks: 3,
    apply: (weapon) => {
      weapon.areaMul += 0.2;
    },
  },
  {
    kind: 'stat',
    id: 'magnet',
    name: 'Magnet Core',
    description: '+40% pickup radius',
    maxStacks: 4,
    apply: (stats) => {
      stats.pickupRadius *= 1.4;
    },
  },
  {
    kind: 'stat',
    id: 'vitality',
    name: 'Vitality',
    description: '+25 max HP, healed on pickup',
    maxStacks: 5,
    apply: (stats) => {
      stats.maxHp += 25;
    },
  },

  /*
   * The second line for each of the two weapons that had only reach to buy.
   * Reach is a defensive shape: it covers more ground without killing anything
   * faster, so a weapon built on it alone stops scaling exactly when the horde
   * stops thinning. These two buy rate instead.
   *
   * They sit at the end because `rollUpgrades` shuffles this array — inserting
   * in the middle changes the offers every seed produces and makes the balance
   * table incomparable with the one before it.
   */
  {
    kind: 'weaponMod',
    id: 'orbit-spin',
    weaponId: 'orbit',
    name: 'Whirling Edge',
    description: 'Orbit Blades turn faster and cut more often',
    maxStacks: 3,
    apply: (weapon) => {
      // Spin and pulse rate move together on purpose. A ring that bites more
      // often without turning faster hits the same arc twice; one that turns
      // faster without biting more often sweeps past enemies between pulses.
      weapon.spinMul += 0.5;
      weapon.attackSpeedMul += 0.4;
    },
  },
  {
    kind: 'weaponMod',
    id: 'nova-cadence',
    weaponId: 'nova',
    name: 'Rolling Thunder',
    description: 'Shockwave bursts more often',
    maxStacks: 3,
    apply: (weapon) => {
      weapon.attackSpeedMul += 0.4;
    },
  },

  /*
   * The tail: what a level is worth once everything above it is bought.
   *
   * Uncapped, and deliberately weaker per pick than the designed upgrades they
   * echo — Whetstone buys +25% damage five times, Grindstone buys +10% forever.
   * The tail is not a replacement for a build, it is what keeps a level from
   * being nothing, and it stays flat enough that a long run scales by degrees
   * instead of running away.
   *
   * Six entries for four slots, so the menu still differs between level-ups
   * instead of showing the same card set forever. Three of them are scoped to a
   * weapon and therefore filtered by ownership, which is what makes the mix
   * depend on the build rather than on nothing.
   *
   * Nothing that compounds, and no move speed. It is the obvious extra line and
   * the one that breaks: enemies spawn into the player's path, so speed bought
   * without limit stops being a stat and starts being an exit.
   */
  {
    kind: 'stat',
    id: 'grindstone',
    name: 'Grindstone',
    description: '+10% damage',
    maxStacks: Infinity,
    fallback: true,
    apply: (stats) => {
      stats.damageMul += 0.1;
    },
  },
  {
    kind: 'stat',
    id: 'reflexes',
    name: 'Muscle Memory',
    description: '+8% attack speed',
    maxStacks: Infinity,
    fallback: true,
    apply: (stats) => {
      stats.attackSpeedMul += 0.08;
    },
  },
  {
    kind: 'stat',
    id: 'scar-tissue',
    name: 'Scar Tissue',
    description: '+20 max HP, healed on pickup',
    maxStacks: Infinity,
    fallback: true,
    apply: (stats) => {
      stats.maxHp += 20;
    },
  },
  {
    kind: 'weaponMod',
    id: 'bolt-heft',
    weaponId: 'bolt',
    name: 'Heavier Bolts',
    description: '+15% Auto Bolt damage',
    maxStacks: Infinity,
    fallback: true,
    apply: (weapon) => {
      weapon.damageMul += 0.15;
    },
  },
  {
    kind: 'weaponMod',
    id: 'orbit-edge',
    weaponId: 'orbit',
    name: 'Keener Edge',
    description: '+15% Orbit Blades damage',
    maxStacks: Infinity,
    fallback: true,
    apply: (weapon) => {
      weapon.damageMul += 0.15;
    },
  },
  {
    kind: 'weaponMod',
    id: 'nova-depth',
    weaponId: 'nova',
    name: 'Deeper Thunder',
    description: '+15% Shockwave damage',
    maxStacks: Infinity,
    fallback: true,
    apply: (weapon) => {
      weapon.damageMul += 0.15;
    },
  },
];

/**
 * The hand-tuned pool, in declaration order.
 *
 * `rollUpgrades` shuffles this and nothing else while it can fill a menu, so a
 * run that never exhausts it draws exactly the offers it drew before the tail
 * existed — the balance table stays comparable across the change.
 */
export const DESIGNED_UPGRADES: readonly UpgradeDef[] = UPGRADES.filter(
  (upgrade) => upgrade.fallback !== true,
);

/** The uncapped tail, offered only to fill what `DESIGNED_UPGRADES` cannot. */
export const FALLBACK_UPGRADES: readonly UpgradeDef[] = UPGRADES.filter(
  (upgrade) => upgrade.fallback === true,
);
