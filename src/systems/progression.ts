import { DESIGNED_UPGRADES, FALLBACK_UPGRADES, UPGRADES } from '../data/upgrades';
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
    // Unreachable while the tail has entries — it is uncapped, so there is
    // always something to offer. Kept as the guard against an empty menu, not
    // as a state the game is expected to reach.
    world.pendingLevels = 0;
    return;
  }

  world.phase = 'levelup';
  world.offered = offers;
}

/**
 * Whether an upgrade can do anything for the player right now.
 *
 * A weapon modifier names a weapon; offering it before that weapon is owned
 * would put a card on the screen that changes nothing, which is worse than a
 * weak card because it looks like a choice.
 */
export function isOfferable(world: World, upgrade: UpgradeDef): boolean {
  if ((world.stacks.get(upgrade.id) ?? 0) >= upgrade.maxStacks) return false;
  if (upgrade.kind !== 'weaponMod') return true;
  return world.weapons.some((weapon) => weapon.defId === upgrade.weaponId);
}

/**
 * Cards shown per level-up.
 *
 * Three, until each weapon got its own upgrades and the pool went from nine
 * entries to thirteen. A bigger pool makes every individual card rarer,
 * including the ones a run is actually built on — levelling a weapon — and the
 * balance stand caught it: the bot stopped finishing runs entirely. A fourth
 * card restores roughly the odds three gave out of nine, and it is worth a win
 * in eight on the table in the README.
 */
/*
 * Exported because the help panel prints the keys that take each card. A hint
 * reading "press 1 2 3" over four cards is worse than no hint at all.
 */
export const OFFERS_PER_LEVEL = 4;

/**
 * Picks up to `count` distinct upgrades that can actually affect this run.
 *
 * The designed pool is drawn first and alone. Only when it can no longer fill
 * the menu is the uncapped tail shuffled in, and that second shuffle is the
 * only extra draw from the run's PRNG — so a run that never spends all fifty
 * designed stacks produces byte-identical offers to one rolled before the tail
 * existed. That is what keeps the balance table in the README comparable.
 */
export function rollUpgrades(world: World, count = OFFERS_PER_LEVEL): UpgradeDef[] {
  const available = DESIGNED_UPGRADES.filter((upgrade) => isOfferable(world, upgrade));
  const offers = world.rng.shuffled(available).slice(0, count);
  if (offers.length >= count) return offers;

  const spare = FALLBACK_UPGRADES.filter((upgrade) => isOfferable(world, upgrade));
  return offers.concat(world.rng.shuffled(spare).slice(0, count - offers.length));
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
  if (!isOfferable(world, def)) return;

  const player = world.player;
  const maxHpBefore = player.stats.maxHp;

  if (def.kind === 'stat') {
    def.apply(player.stats);
  } else if (def.kind === 'weapon') {
    grantWeapon(world, def.weaponId);
  } else {
    // Guarded by isOfferable above, so the weapon is owned. Skipping rather
    // than throwing keeps a bad id from ending a run.
    const weapon = world.weapons.find((owned) => owned.defId === def.weaponId);
    if (weapon === undefined) return;
    def.apply(weapon);
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
