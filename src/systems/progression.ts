import { DESIGNED_UPGRADES, FALLBACK_UPGRADES, UPGRADES } from '../data/upgrades';
import { NOBODY } from '../world/world';
import { grantWeapon } from './weapons';
import type { UpgradeDef } from '../data/upgrades';
import type { Player } from '../world/types';
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
 * Converts accumulated XP into levels and pauses the run when somebody has an
 * upgrade to pick. Multiple levels gained in one tick queue up in
 * `pendingLevels` and are offered one after another.
 *
 * XP is banked for every player, and then at most one menu opens — the first
 * player in the list who is owed a level. That the run freezes behind it is a
 * leftover from there being only one player to freeze it for, and it is the
 * next thing to go: with four of them, one person reading cards must not stop
 * the other three's world. The banking is already per player, so what changes
 * is where the menu lives, not how levels are earned.
 */
export function progressionSystem(world: World): void {
  const players = world.players;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    while (player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level++;
      player.xpToNext = xpForLevel(player.level);
      player.pendingLevels++;
    }
  }

  if (world.phase !== 'playing') return;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.pendingLevels <= 0) continue;

    const offers = rollUpgrades(world, player);
    if (offers.length === 0) {
      // Unreachable while the tail has entries — it is uncapped, so there is
      // always something to offer. Kept as the guard against an empty menu, not
      // as a state the game is expected to reach.
      player.pendingLevels = 0;
      continue;
    }

    world.phase = 'levelup';
    world.choosing = i;
    player.offered = offers;
    return;
  }
}

/**
 * Whether an upgrade can do anything for the player right now.
 *
 * A weapon modifier names a weapon; offering it before that weapon is owned
 * would put a card on the screen that changes nothing, which is worse than a
 * weak card because it looks like a choice.
 */
export function isOfferable(player: Player, upgrade: UpgradeDef): boolean {
  if ((player.stacks.get(upgrade.id) ?? 0) >= upgrade.maxStacks) return false;
  if (upgrade.kind !== 'weaponMod') return true;
  return player.weapons.some((weapon) => weapon.defId === upgrade.weaponId);
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
export function rollUpgrades(world: World, player: Player, count = OFFERS_PER_LEVEL): UpgradeDef[] {
  const available = DESIGNED_UPGRADES.filter((upgrade) => isOfferable(player, upgrade));
  const offers = world.rng.shuffled(available).slice(0, count);
  if (offers.length >= count) return offers;

  const spare = FALLBACK_UPGRADES.filter((upgrade) => isOfferable(player, upgrade));
  return offers.concat(world.rng.shuffled(spare).slice(0, count - offers.length));
}

/**
 * Applies the chosen upgrade to one player, and either offers them the next
 * queued level or resumes the run.
 *
 * The player is named by the caller rather than looked up from `world.choosing`
 * on purpose: this is also how a harness builds a loadout with no menu open at
 * all, and a function that only worked mid-level-up would need a second one
 * beside it that did the same thing.
 */
export function applyUpgrade(world: World, player: Player, id: string): void {
  const def = UPGRADES.find((upgrade) => upgrade.id === id);
  if (def === undefined) return;

  const stacks = player.stacks.get(id) ?? 0;
  if (stacks >= def.maxStacks) return;
  if (!isOfferable(player, def)) return;

  const maxHpBefore = player.stats.maxHp;

  if (def.kind === 'stat') {
    def.apply(player.stats);
  } else if (def.kind === 'weapon') {
    grantWeapon(player, def.weaponId);
  } else {
    // Guarded by isOfferable above, so the weapon is owned. Skipping rather
    // than throwing keeps a bad id from ending a run.
    const weapon = player.weapons.find((owned) => owned.defId === def.weaponId);
    if (weapon === undefined) return;
    def.apply(weapon);
  }

  player.stacks.set(id, stacks + 1);

  // Max-HP upgrades heal by the amount they grant, otherwise taking one at low
  // health is a trap rather than a reward.
  const gained = player.stats.maxHp - maxHpBefore;
  if (gained > 0) {
    player.hp = Math.min(player.stats.maxHp, player.hp + gained);
  }

  player.pendingLevels--;

  if (player.pendingLevels > 0) {
    player.offered = rollUpgrades(world, player);
    if (player.offered.length > 0) return;
    player.pendingLevels = 0;
  }

  player.offered = [];
  world.choosing = NOBODY;
  world.phase = 'playing';
}
