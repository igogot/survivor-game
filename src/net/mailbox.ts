import type { LobbyMessage } from './lobby';

/**
 * The waiting room, over the wire.
 *
 * `BroadcastChannel` reaches every window of one browser and stops at the edge
 * of the machine. This is the other half: a message posted to `api/room.php`
 * and picked up by whoever polls for it, so a code read down the phone reaches
 * somebody in another house.
 *
 * Polling, and not apologetically. A lobby is a handful of messages — a knock,
 * a roster, a line of chat, a start — and the thing it is worst at, latency,
 * is the thing a waiting room cares least about. What it is good at is
 * arriving: there is no long-lived process on this project's hosting to hold a
 * socket open, so the alternative to a poll is nothing at all.
 *
 * It is not, and must never become, how a run travels. A snapshot is four
 * kilobytes twenty times a second; posting that to a shared host would be
 * unkind to the host and unplayable for everybody. What this carries once a
 * team is formed is the introduction between two browsers, and after that they
 * talk to each other directly — see `webrtc.ts`.
 */

const ENDPOINT = import.meta.env.VITE_ROOM_URL ?? 'api/room.php';

/**
 * How often a client asks for its post.
 *
 * Fast enough that a knock is answered inside a second and a line of chat lands
 * while the person who sent it is still looking, slow enough that four people
 * in a room are a handful of requests a second between them rather than a
 * denial of service against a plan that costs a few hundred roubles a year.
 */
const POLL_MS = 800;

/** Long enough to survive a slow phone network, short enough to notice a dead host. */
const TIMEOUT_MS = 6000;

/**
 * A message with something to tell it apart by.
 *
 * The nonce is the transport's, not the lobby's. Two channels carry every
 * message — the local one and this — so a second window on the same machine
 * hears everything twice, and something has to say "this is the one I already
 * had". The lobby's own messages have no identity and should not grow one for
 * a problem that belongs down here.
 */
export interface Envelope<T = LobbyMessage> {
  readonly n: string;
  readonly m: T;
}

export interface Mailbox {
  /** Starts polling a room. Called when a lobby gets a code. */
  join(code: string, me: string): void;
  /** Stops. Called when it gives one up. */
  leave(): void;
  post(envelope: Envelope): void;
}

/** What a `fetch` has to look like, so a test can be one. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function openMailbox(
  onMessage: (envelope: Envelope) => void,
  fetcher: Fetcher = (url, init) => fetch(url, init),
  endpoint: string = ENDPOINT,
): Mailbox {
  let code: string | null = null;
  let me = '';
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const poll = async (): Promise<void> => {
    const room = code;
    if (room === null) return;

    try {
      const url = `${endpoint}?code=${room}&since=${cursor}&me=${me}`;
      const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.ok) {
        const body = (await response.json()) as {
          cursor?: number;
          messages?: readonly Envelope[];
        };
        // The cursor only ever moves forward, and only on an answer that
        // parsed. A failed poll is a poll to try again, not a reason to skip
        // whatever it would have said.
        if (typeof body.cursor === 'number') cursor = Math.max(cursor, body.cursor);
        for (const envelope of body.messages ?? []) onMessage(envelope);
      }
    } catch {
      // A room that cannot be reached is a quiet room. Everything this carries
      // is also on the local channel, and a lobby that threw on a dropped
      // request would take the game down with it for a player who is not even
      // using the network.
    }

    // Scheduled after the answer rather than on an interval, so a slow network
    // makes for fewer requests instead of a queue of overlapping ones.
    if (code === room) timer = setTimeout(() => void poll(), POLL_MS);
  };

  return {
    join(newCode, newMe) {
      stop();
      code = newCode;
      me = newMe;
      // A fresh room starts from nothing: whatever is still in the table under
      // this code is somebody else's conversation from a quarter of an hour ago.
      cursor = 0;
      void poll();
    },

    leave() {
      stop();
      code = null;
    },

    post(envelope) {
      const room = code;
      if (room === null) return;

      void fetcher(`${endpoint}?code=${room}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: me, message: envelope }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => {
        // Same reasoning as the poll: unreachable is quiet, not broken.
      });
    },
  };
}
