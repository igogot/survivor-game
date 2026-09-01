import { openMailbox } from './mailbox';
import type { Envelope } from './mailbox';
import type { LobbyMessage } from './lobby';

/**
 * How a lobby's messages travel, and the one place that knows they travel at
 * all.
 *
 * `Lobby` decides; this delivers. The interface is deliberately tiny — send a
 * message, hear messages — because it is a seam rather than a feature:
 * what plugs in here today reaches the other windows on one machine, and what
 * plugs in later reaches another machine. Neither changes a line of the state
 * machine.
 */
export interface LobbyChannel {
  send(message: LobbyMessage): void;
  /**
   * Which room this channel is carrying, so the half of it that goes over the
   * network knows what to poll for. The local half neither needs nor notices
   * it: a broadcast has no address.
   */
  join(code: string, me: string): void;
  leave(): void;
}

/**
 * Something to tell one delivery of a message from another.
 *
 * Every message goes out on both channels, so a second window on the same
 * machine hears each one twice — once as a broadcast and once as post. A nonce
 * is what lets the far end say "already had this". It belongs to the transport
 * rather than to the lobby: the messages themselves have no identity and should
 * not grow one for a problem that is not theirs.
 */
export function nonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * How many deliveries back a channel remembers.
 *
 * Enough that a duplicate arriving a poll later is still recognised, small
 * enough that a room left open all evening is a set of a few hundred short
 * strings rather than a leak.
 */
const SEEN_LIMIT = 512;

/**
 * Wraps a handler so it only ever hears a message once.
 *
 * Its own function so it can be tested without a browser: the thing worth
 * checking is that a duplicate is dropped and a genuine repeat of the same
 * *content* is not, and neither needs a `BroadcastChannel` to demonstrate.
 */
export function dedupe<T>(onMessage: (message: T) => void): (envelope: Envelope<T>) => void {
  const seen = new Set<string>();

  return (envelope) => {
    if (seen.has(envelope.n)) return;

    seen.add(envelope.n);
    if (seen.size > SEEN_LIMIT) {
      // Oldest first: a `Set` iterates in insertion order, which is exactly the
      // order to forget things in.
      for (const old of seen) {
        seen.delete(old);
        if (seen.size <= SEEN_LIMIT) break;
      }
    }

    onMessage(envelope.m);
  };
}

/** The names every window of this game agrees on. */
const LOBBY_CHANNEL = 'survivor-lobby';

/**
 * A second channel for the run itself.
 *
 * Separate from the lobby's because the two carry different things at different
 * rates — a roster changes when somebody walks in, a snapshot twenty times a
 * second — and a lobby that had to skip past thousands of snapshots to find its
 * own messages would be paying for the run all game. A transport that costs
 * something to open, which the next one will, would multiplex these onto one
 * connection instead; the seam is the same either way.
 */
const GAME_CHANNEL = 'survivor-game';

/**
 * A channel across the windows of one browser.
 *
 * `BroadcastChannel` reaches every tab and window on the same origin, which is
 * exactly the shape a waiting room wants and exactly not the reach it
 * eventually needs. It is here because it makes the whole flow real today —
 * open two windows, create a team in one, type the code into the other, and
 * watch the roster fill — with no server to run and nothing to configure.
 *
 * What it cannot do is leave the machine, and the README says so rather than
 * letting a player discover it by reading a code down the phone to a friend.
 *
 * Absent in a browser too old for it and in Node, so the constructor answers
 * with a channel that swallows what it is given. A lobby with no channel is a
 * lobby where nobody ever arrives, which is a disappointing room rather than a
 * broken page.
 */
/**
 * The waiting room's channel: both ways of reaching somebody at once.
 *
 * `BroadcastChannel` is instant and stops at the edge of the machine; the
 * mailbox is a poll away and does not. Sending on both and dropping the
 * duplicates is simpler than choosing, and it has a property choosing does not:
 * two windows on one machine keep working when the network is unreachable, and
 * a player who never opens a second window never notices there is a network.
 */
export function openLobbyChannel(onMessage: (message: LobbyMessage) => void): LobbyChannel {
  const deliver = dedupe(onMessage);
  const local = open<Envelope<LobbyMessage>>(LOBBY_CHANNEL, deliver);
  const mail = openMailbox(deliver);

  return {
    send(message) {
      const envelope: Envelope = { n: nonce(), m: message };
      local.send(envelope);
      mail.post(envelope);
    },
    join: (code, me) => mail.join(code, me),
    leave: () => mail.leave(),
  };
}

/**
 * The same, for the messages a run is made of.
 *
 * Generic in what it carries because a run's messages travel wrapped: two
 * transports deliver each one, and the wrapper is what lets the far end tell a
 * second delivery from a second message. See `dedupe`.
 */
export function openGameChannel<T>(onMessage: (message: T) => void): { send(message: T): void } {
  return open<T>(GAME_CHANNEL, onMessage);
}

function open<T>(name: string, onMessage: (message: T) => void): { send(message: T): void } {
  const Channel = globalThis.BroadcastChannel;
  if (Channel === undefined) return SILENT;

  const channel = new Channel(name);
  channel.onmessage = (event: MessageEvent<T>) => onMessage(event.data);

  // Never closed: the page owns it for as long as the page exists, and there is
  // no second one to leak. A transport that does need taking down can add that
  // when it arrives — an interface method nothing calls is a promise nobody
  // keeps.
  return { send: (message) => channel.postMessage(message) };
}

const SILENT = { send: () => {} };
