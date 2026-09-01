import { CONFIG } from '../config';
import type { Player } from './types';
import type { World } from './world';

/**
 * The questions that had exactly one answer while there was exactly one player.
 *
 * "Which player does this enemy walk toward", "where does the spawn ring go",
 * "how far is too far to keep a body alive" — every one of them used to read
 * `world.player` and be done. With a party they are decisions, and putting them
 * here rather than inlining an answer in each system is what makes them
 * decisions that can be found and changed together.
 */

/** A player still standing. The dead are not targets and not anchors. */
export function isAlive(player: Player): boolean {
  return player.hp > 0;
}

/** Whether the run is still going, i.e. anybody is left to play it. */
export function anyAlive(world: World): boolean {
  return world.players.some(isAlive);
}

/**
 * How many players the game is currently being played by.
 *
 * The party's size for every purpose that has one, and there are two: it
 * divides the experience bar and it multiplies enemy health. Those two have to
 * be the same number or a party gets a discount on one side of the ledger —
 * which is why this is a function here rather than a `players.length` written
 * out at each of them.
 *
 * The living, not the roster. Somebody who has fallen is neither filling the
 * bar nor shooting at anything, so charging the survivors for them would make
 * a death a punishment on top of a death.
 *
 * Never zero. A wiped party has no more ticks coming, but the HUD may still be
 * asked to draw one last frame, and dividing by nothing there is not worth the
 * crash.
 */
export function partySize(world: World): number {
  let alive = 0;
  for (let i = 0; i < world.players.length; i++) {
    if (isAlive(world.players[i])) alive++;
  }
  return Math.max(1, alive);
}

/**
 * The next living player after `from`, wrapping round.
 *
 * What the left mouse button does for somebody watching from the dead, and what
 * `respawnSystem` falls back on when the player being watched falls too.
 * Answers `from` when nobody else is standing, which a caller checks for by
 * asking whether that player is alive.
 */
export function nextLiving(world: World, from: number): number {
  const players = world.players;

  for (let step = 1; step <= players.length; step++) {
    const index = (from + step) % players.length;
    if (isAlive(players[index])) return index;
  }

  return from;
}

/**
 * Whose eyes a screen should use for this player.
 *
 * Their own while they are standing, and the one they are watching while they
 * are not. Both the camera and the HUD ask, so that a downed player's screen is
 * one coherent view of somebody else rather than a camera over there and a
 * health bar over here.
 */
export function viewedBy(world: World, player: Player): Player {
  if (isAlive(player)) return player;

  const watched = world.players[player.watching];
  if (watched !== undefined && isAlive(watched)) return watched;

  return nearestPlayer(world, player.x, player.y) ?? player;
}

/**
 * How much faster the horde arrives, and how much tougher each body is.
 *
 * One multiplier of `partySize` split between the two by
 * `CONFIG.spawn.perPlayerArrivals`, because they are two ends of one slider
 * rather than two levers. `arrivalScale * healthScale` is always the party's
 * size, which is the condition for the horde being killed as fast as it comes —
 * see the note on that setting for why turning both up runs away.
 *
 * Both are exactly 1 for a solo run whatever the split is, so every number this
 * project has ever measured alone is untouched.
 */
export function arrivalScale(world: World): number {
  return Math.pow(partySize(world), CONFIG.spawn.perPlayerArrivals);
}

export function healthScale(world: World): number {
  return Math.pow(partySize(world), 1 - CONFIG.spawn.perPlayerArrivals);
}

/**
 * The living player nearest a point, or null when the party is wiped.
 *
 * Nearest rather than anything cleverer, and that is a choice worth naming: it
 * is the rule that makes splitting up strong, because a party spread over four
 * corners is four separate horde-halves that never meet. Whether it stays the
 * rule is a question for the four-player stand, and this is the one place that
 * has to change when the answer comes back.
 */
export function nearestPlayer(world: World, x: number, y: number): Player | null {
  const players = world.players;

  let nearest: Player | null = null;
  let nearestDistance = Infinity;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!isAlive(player)) continue;

    const dx = player.x - x;
    const dy = player.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = player;
    }
  }

  return nearest;
}

/** Squared distance from a point to the nearest living player, or Infinity. */
export function nearestPlayerDistanceSq(world: World, x: number, y: number): number {
  const nearest = nearestPlayer(world, x, y);
  if (nearest === null) return Infinity;

  const dx = nearest.x - x;
  const dy = nearest.y - y;
  return dx * dx + dy * dy;
}

/**
 * Where the party is and where it is going, as one point and one direction.
 *
 * The spawner needs both: it puts enemies on a ring around the player and
 * biases two thirds of them into the direction of travel. With four of them
 * there is no single position and no single heading, so this averages the
 * living ones.
 *
 * A centroid is the crude answer and deliberately the first one: it keeps a
 * party that stays together behaving exactly as one player did, and it makes a
 * party that scatters share one wave instead of each summoning their own. What
 * it does badly is the scattered case — the ring can land in the middle of
 * nobody — and that is a thing to measure rather than to pre-empt.
 *
 * With one player the sums are divided by one, so every number that comes out
 * of here is bit-for-bit what `world.player` used to give.
 */
export interface PartyAnchor {
  x: number;
  y: number;
  headingX: number;
  headingY: number;
}

const EMPTY: PartyAnchor = { x: 0, y: 0, headingX: 0, headingY: 0 };

export function partyAnchor(world: World): PartyAnchor {
  const players = world.players;

  let count = 0;
  let x = 0;
  let y = 0;
  let headingX = 0;
  let headingY = 0;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!isAlive(player)) continue;

    count++;
    x += player.x;
    y += player.y;
    headingX += player.headingX;
    headingY += player.headingY;
  }

  if (count === 0) return EMPTY;

  return { x: x / count, y: y / count, headingX: headingX / count, headingY: headingY / count };
}
