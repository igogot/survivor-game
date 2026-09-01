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
}

/** The name every window of this game agrees on. */
const CHANNEL_NAME = 'survivor-lobby';

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
export function openLobbyChannel(onMessage: (message: LobbyMessage) => void): LobbyChannel {
  const Channel = globalThis.BroadcastChannel;
  if (Channel === undefined) return SILENT;

  const channel = new Channel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<LobbyMessage>) => onMessage(event.data);

  // Never closed: the page owns it for as long as the page exists, and there is
  // no second one to leak. A transport that does need taking down can add that
  // when it arrives — an interface method nothing calls is a promise nobody
  // keeps.
  return { send: (message) => channel.postMessage(message) };
}

const SILENT: LobbyChannel = { send: () => {} };
