import type { PlayerStats } from '../world/types';

interface UpgradeBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** How many times this upgrade may be taken in one run. */
  readonly maxStacks: number;
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

export type UpgradeDef = StatUpgradeDef | WeaponUpgradeDef;

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
    name: 'Sharpened Bolts',
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
    kind: 'stat',
    id: 'multishot',
    name: 'Split Shot',
    description: '+1 projectile',
    maxStacks: 4,
    apply: (stats) => {
      stats.projectiles += 1;
    },
  },
  {
    kind: 'stat',
    id: 'pierce',
    name: 'Piercing Tip',
    description: 'Projectiles pierce one more enemy',
    maxStacks: 3,
    apply: (stats) => {
      stats.pierce += 1;
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
];
