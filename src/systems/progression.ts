import { UPGRADES } from '../data/upgrades';
import { grantWeapon } from './weapons';
import type { UpgradeDef } from '../data/upgrades';
import type { World } from '../world/world';

/**
 * XP required to go from `level` to `level + 1`.
 *
 * Quadratic rather than exponential: levels should keep arriving all run, just
 * more slowly, because each one is a decision point and the run stops being fun
 * when they dry up.
 */
export function xpForLevel(level: number): number {
  return Math.floor(5 + level * 4 + level * level * 0.6);
}

/**
 * Converts accumulated XP into levels and pauses the run when there is an
 * upgrade to pick. Multiple levels gained in one tick queue up in
 * `pendingLevels` and are offered one after another.
 */
export function progressionSystem(world: World): void {
  const player = world.player;

  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.xpToNext = xpForLevel(player.level);
    world.pendingLevels++;
  }

  if (world.pendingLevels <= 0 || world.phase !== 'playing') return;

  const offers = rollUpgrades(world);
  if (offers.length === 0) {
    // Everything is maxed — swallow the level instead of showing an empty menu.
    world.pendingLevels = 0;
    return;
  }

  world.phase = 'levelup';
  world.offered = offers;
}

/** Picks up to `count` distinct upgrades that are not already at max stacks. */
export function rollUpgrades(world: World, count = 3): UpgradeDef[] {
  const available = UPGRADES.filter(
    (upgrade) => (world.stacks.get(upgrade.id) ?? 0) < upgrade.maxStacks,
  );
  return world.rng.shuffled(available).slice(0, count);
}

/**
 * Applies the chosen upgrade and either offers the next queued level or resumes
 * the run.
 */
export function applyUpgrade(world: World, id: string): void {
  const def = UPGRADES.find((upgrade) => upgrade.id === id);
  if (def === undefined) return;

  const stacks = world.stacks.get(id) ?? 0;
  if (stacks >= def.maxStacks) return;

  const player = world.player;
  const maxHpBefore = player.stats.maxHp;

  if (def.kind === 'stat') {
    def.apply(player.stats);
  } else {
    grantWeapon(world, def.weaponId);
  }

  world.stacks.set(id, stacks + 1);

  // Max-HP upgrades heal by the amount they grant, otherwise taking one at low
  // health is a trap rather than a reward.
  const gained = player.stats.maxHp - maxHpBefore;
  if (gained > 0) {
    player.hp = Math.min(player.stats.maxHp, player.hp + gained);
  }

  world.pendingLevels--;

  if (world.pendingLevels > 0) {
    world.offered = rollUpgrades(world);
    if (world.offered.length > 0) return;
    world.pendingLevels = 0;
  }

  world.offered = [];
  world.phase = 'playing';
}
