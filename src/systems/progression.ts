import { DESIGNED_UPGRADES, FALLBACK_UPGRADES, UPGRADES } from '../data/upgrades';
import { isAlive, partySize } from '../world/party';
import { NOBODY } from '../world/world';
import { healPlayer } from './damage';
import { grantWeapon } from './weapons';
import type { UpgradeDef } from '../data/upgrades';
import type { Player } from '../world/types';
import type { World } from '../world/world';

/**
 * XP one player would need to go from `level` to `level + 1`.
 *
 * Quadratic rather than exponential: levels should keep arriving all run, just
 * more slowly, because each one is a decision point and the run stops being fun
 * when they dry up.
 */
export function xpForLevel(level: number): number {
  return Math.floor(5 + level * 4 + level * level * 0.6);
}

/**
 * What the shared bar costs right now: one player's worth per player filling
 * it.
 *
 * Derived rather than stored, and that is the whole reason it is a function. A
 * party of four that loses one becomes a party of three, and three people
 * should not go on paying a four's price for a level only three of them will
 * get. A stored target would have to be recomputed by whoever handles a death,
 * which is exactly the sort of bookkeeping that gets forgotten once and then
 * lies about the bar for the rest of the run.
 *
 * Falling below the current XP is not a problem to guard against: the bar is
 * simply full, and `progressionSystem` hands out the level on the next tick.
 * Somebody dying can therefore level the survivors, which is the right reading
 * of it — the share they were carrying is gone.
 *
 * With one player it is `xpForLevel(level)` multiplied by one, so every solo
 * run is exactly the run it was.
 */
export function xpForNextLevel(world: World): number {
  return xpForLevel(world.level) * partySize(world);
}

/**
 * Converts the party's accumulated XP into levels and pauses the run when
 * somebody has an upgrade to pick.
 *
 * One bar, one level, and everybody standing gets it. Then at most one menu
 * opens — the first player in the list who is owed a card — and the rest queue
 * in their own `pendingLevels` until it is their turn. That the run freezes
 * behind each of them is a leftover from there being only one player to freeze
 * it for, and it is the next thing to go: with four of them, one person reading
 * cards must not stop the other three's world.
 */
export function progressionSystem(world: World): void {
  const players = world.players;

  let cost = xpForNextLevel(world);
  while (world.xp >= cost) {
    world.xp -= cost;
    world.level++;

    // Everyone still standing, and only them. A level is a card to pick, and a
    // corpse has nothing to pick it with.
    for (let i = 0; i < players.length; i++) {
      if (isAlive(players[i])) players[i].pendingLevels++;
    }

    cost = xpForNextLevel(world);
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
  healPlayer(player, player.stats.maxHp - maxHpBefore);

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
