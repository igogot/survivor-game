import { CONFIG } from '../config';
import { TAU } from '../core/math';
import { isAlive, nextLiving } from '../world/party';
import type { World } from '../world/world';

/**
 * Being dead, and stopping being dead.
 *
 * A run ends when the last player falls, so a death with somebody left standing
 * is a wait rather than an ending — and a wait is a thing the simulation has to
 * hold: how long is left, whose shoulder the waiting player is looking over,
 * and where they come back.
 *
 * The wait is `(players - 1)` minutes: a pair wait one, a three wait two, a four
 * wait three. It scales with the party because that is what the wait costs the
 * others — one person down out of two is half the team's guns, one out of four
 * is a quarter, and the bigger group can afford to carry somebody for longer.
 * Solo comes out at zero and never reaches it: the last player falling ends the
 * run before there is anything to count down.
 */

/**
 * How far from the watched player somebody comes back, in world units.
 *
 * Exported so a test can assert where a body reappears without knowing the
 * arithmetic — close enough to be beside them, far enough not to be inside
 * them.
 */
export const RESPAWN_OFFSET = 44;

/**
 * Seconds a player waits before coming back, for a party of this size.
 *
 * Read off the roster rather than off who is still standing. Otherwise a second
 * death would shorten the first player's wait, which reads as the game
 * rewarding the party for falling apart.
 */
export function respawnDelay(world: World): number {
  return (world.players.length - 1) * CONFIG.player.respawnPerTeammate;
}

/**
 * Advances the dead: keeps their camera on somebody alive, and brings them back
 * when their time is up.
 *
 * Runs before the spawner so that a player returning this tick is part of the
 * party the horde is sized against — see `partySize`, which both the spawn
 * curve and the experience bar read.
 */
export function respawnSystem(world: World): void {
  const players = world.players;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (isAlive(player)) continue;

    // The watched player may have fallen since. Following a corpse would leave
    // the camera on empty ground while the run carried on somewhere else.
    if (!isAlive(players[player.watching] ?? player)) {
      player.watching = nextLiving(world, player.watching);
    }

    const host = players[player.watching];
    if (host === undefined || !isAlive(host)) continue;
    if (world.time < player.respawnAt) continue;

    revive(world, i, player.watching);
  }
}

/**
 * Puts a player back, beside the one they were watching.
 *
 * Beside rather than on top, and beside *them* rather than at the origin: the
 * camera has been over that shoulder for a minute, so it is the one place on an
 * endless plane the returning player already understands. It also makes the
 * choice of who to watch a decision with a consequence, which is the only thing
 * that makes it a choice at all.
 *
 * The angle is the run's own PRNG, which is safe for every table this project
 * has ever measured: nobody respawns in a solo run, so a solo run never draws
 * from it.
 */
function revive(world: World, index: number, hostIndex: number): void {
  const player = world.players[index];
  const host = world.players[hostIndex];

  const angle = world.rng.next() * TAU;
  player.x = host.x + Math.cos(angle) * RESPAWN_OFFSET;
  player.y = host.y + Math.sin(angle) * RESPAWN_OFFSET;
  player.px = player.x;
  player.py = player.y;

  player.hp = player.stats.maxHp;
  player.respawnAt = 0;

  // Long enough to read the screen and pick a direction. Coming back inside the
  // crowd that killed the player they were watching, on the ordinary half a
  // second of grace, would be a respawn that spends itself on the same tick.
  player.invuln = CONFIG.player.respawnGrace;

  // Whatever they were holding when they died is not an instruction now.
  player.intentX = 0;
  player.intentY = 0;
  player.moveTarget = null;
}
