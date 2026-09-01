import { makeCode, makeMemberId } from './code';

/**
 * The waiting room, as a state machine with no browser in it.
 *
 * One player creates a team and is handed a code; the others type that code in
 * and appear in the room. That is the whole feature, and all of it is here —
 * what is *not* here is how the messages travel, which is `channel.ts`. The
 * split is the same one the rest of this project keeps between `World` and the
 * renderer: this file can be driven from a test in Node, and the thing that
 * knows about `BroadcastChannel` cannot decide anything.
 *
 * The host owns the roster. Guests do not track each other — they display what
 * the host last told them — because two people who both think they are keeping
 * the list is how a lobby ends up showing different rooms to different people.
 *
 * Chat is the exception and does not go through the host, because it does not
 * have to: a line is not a fact about the room that two people could disagree
 * on, it is a thing somebody said. Everyone keeps their own log of what reached
 * them, which is also the only honest thing a log can be — somebody who joined
 * late did not hear what was said before they arrived, and pretending otherwise
 * would mean inventing a history to hand them.
 */

/** Four, which is what the world can hold. See `World`'s constructor. */
export const MAX_PARTY = 4;

/**
 * The longest thing anybody can say at once.
 *
 * A waiting room's chat is "ready?", "give me a second", "what's the code
 * again" — a limit generous enough for all of those and short enough that one
 * person cannot fill everybody's screen.
 */
export const MAX_SAID = 160;

/**
 * How many lines are kept.
 *
 * The log is a room's short-term memory rather than a transcript: nobody
 * scrolls a lobby, and holding an unbounded array for a screen that exists for
 * two minutes is a leak with a nice name.
 */
export const CHAT_HISTORY = 50;

export type LobbyPhase = 'idle' | 'hosting' | 'joining' | 'joined' | 'error';

/** Why a join did not happen, in the terms a player would put it. */
export type LobbyError = 'notFound' | 'full' | 'closed';

export type LobbyMessage =
  | { readonly kind: 'hello'; readonly code: string; readonly from: string }
  | { readonly kind: 'roster'; readonly code: string; readonly members: readonly string[] }
  | { readonly kind: 'full'; readonly code: string; readonly to: string }
  | { readonly kind: 'bye'; readonly code: string; readonly from: string }
  | { readonly kind: 'closed'; readonly code: string }
  | { readonly kind: 'chat'; readonly code: string; readonly from: string; readonly text: string };

/**
 * One thing somebody said.
 *
 * The seat is resolved when the line arrives rather than when it is drawn, and
 * that is deliberate: a log is a record of what was said, so a line must not
 * change who said it because somebody later left and the roster shifted under
 * it.
 */
export interface ChatLine {
  readonly seat: number;
  readonly text: string;
  readonly mine: boolean;
}

export interface LobbyState {
  readonly phase: LobbyPhase;
  /** The team's code once there is one, or '' while there is not. */
  readonly code: string;
  /** Everyone in the room, host first. Empty until a roster arrives. */
  readonly members: readonly string[];
  readonly self: string;
  readonly hosting: boolean;
  readonly error: LobbyError | null;
  /** What has been said in this room, oldest first. */
  readonly chat: readonly ChatLine[];
}

export class Lobby {
  private phase: LobbyPhase = 'idle';
  private code = '';
  private members: string[] = [];
  private hosting = false;
  private error: LobbyError | null = null;
  private chat: ChatLine[] = [];

  readonly self: string;

  /**
   * `send` puts a message where everyone else in the room will see it, and
   * `random` makes codes and identities. Both are handed in so that a test can
   * run two lobbies against a shared array and know what code it will get.
   */
  constructor(
    private readonly send: (message: LobbyMessage) => void,
    private readonly random: () => number,
  ) {
    this.self = makeMemberId(random);
  }

  state(): LobbyState {
    return {
      phase: this.phase,
      code: this.code,
      members: this.members,
      self: this.self,
      hosting: this.hosting,
      error: this.error,
      chat: this.chat,
    };
  }

  /** Opens a room and answers with its code, which is the thing to read out. */
  host(): string {
    this.code = makeCode(this.random);
    this.members = [this.self];
    this.hosting = true;
    this.error = null;
    this.chat = [];
    this.phase = 'hosting';
    return this.code;
  }

  /**
   * Knocks on a code.
   *
   * There is no reply to wait for if nobody is there, so this only asks — the
   * caller decides how long to wait and calls `giveUp`. Putting the clock out
   * here rather than in this file is what keeps it free of timers.
   */
  join(code: string): void {
    this.code = code;
    this.members = [];
    this.hosting = false;
    this.error = null;
    this.chat = [];
    this.phase = 'joining';
    this.send({ kind: 'hello', code, from: this.self });
  }

  /** Nobody answered. Only means anything while a knock is outstanding. */
  giveUp(): void {
    if (this.phase !== 'joining') return;
    this.fail('notFound');
  }

  /**
   * Walks out, and tells the room.
   *
   * A host leaving closes the room rather than handing it on. Migrating the
   * host is a real feature with real failure modes, and a waiting room that
   * has not started anything is the one place where "everybody go again" is an
   * honest answer.
   */
  leave(): void {
    if (this.phase === 'hosting') {
      this.send({ kind: 'closed', code: this.code });
    } else if (this.phase === 'joined' || this.phase === 'joining') {
      this.send({ kind: 'bye', code: this.code, from: this.self });
    }
    this.reset();
  }

  /** Back to the start, without telling anybody — for a dismissed error. */
  reset(): void {
    this.phase = 'idle';
    this.code = '';
    this.members = [];
    this.hosting = false;
    this.error = null;
    this.chat = [];
  }

  /**
   * Says something to the room.
   *
   * Appended locally as well as sent, because a broadcast does not come back to
   * whoever made it — the sender has to put their own words on their own screen
   * or the one person who knows what was said is the one who cannot see it.
   * `receive` drops anything from `self` for the same reason: a transport that
   * *does* echo must not double every line.
   *
   * Empty is not a message. Trimming first means a stray Enter on an untouched
   * field is nothing rather than a blank row in everybody's log.
   */
  say(text: string): void {
    if (this.phase !== 'hosting' && this.phase !== 'joined') return;

    const said = text.trim().slice(0, MAX_SAID);
    if (said.length === 0) return;

    this.remember(this.self, said);
    this.send({ kind: 'chat', code: this.code, from: this.self, text: said });
  }

  /**
   * Everything arriving on the channel, including this lobby's own messages.
   *
   * A broadcast has no addressing, so the first thing every branch does is ask
   * whether the message is about this room and not somebody else's — two teams
   * on one machine is a normal thing to be testing with.
   */
  receive(message: LobbyMessage): void {
    if (message.code !== this.code || this.phase === 'idle') return;

    switch (message.kind) {
      case 'hello':
        this.admit(message.from);
        break;
      case 'roster':
        this.adopt(message.members);
        break;
      case 'full':
        if (message.to === this.self && this.phase === 'joining') this.fail('full');
        break;
      case 'bye':
        this.dismiss(message.from);
        break;
      case 'closed':
        if (!this.hosting) this.fail('closed');
        break;
      case 'chat':
        // Only from somebody sitting in this room, and never the echo of one's
        // own words. A line from a stranger who happens to know the code is the
        // one thing a shared secret is supposed to make impossible, and
        // checking is cheaper than trusting it.
        if (message.from !== this.self && this.members.includes(message.from)) {
          this.remember(message.from, message.text.trim().slice(0, MAX_SAID));
        }
        break;
      default: {
        // Exhaustiveness check: a message kind added without a branch here
        // stops compiling rather than being quietly ignored on the wire.
        const unhandled: never = message;
        throw new Error(`Unhandled lobby message: ${String(unhandled)}`);
      }
    }
  }

  private admit(from: string): void {
    if (!this.hosting || from === this.self) return;

    if (!this.members.includes(from)) {
      if (this.members.length >= MAX_PARTY) {
        this.send({ kind: 'full', code: this.code, to: from });
        return;
      }
      this.members = [...this.members, from];
    }

    // Answered even when they were already on the list: a guest re-knocking is
    // a guest who did not hear the first answer.
    this.send({ kind: 'roster', code: this.code, members: this.members });
  }

  private adopt(members: readonly string[]): void {
    if (this.hosting || !members.includes(this.self)) return;
    this.members = [...members];
    this.phase = 'joined';
    this.error = null;
  }

  private dismiss(from: string): void {
    if (!this.hosting) return;

    const without = this.members.filter((member) => member !== from);
    if (without.length === this.members.length) return;

    this.members = without;
    this.send({ kind: 'roster', code: this.code, members: this.members });
  }

  private remember(from: string, text: string): void {
    if (text.length === 0) return;

    const seat = this.members.indexOf(from);
    this.chat = [...this.chat, { seat, text, mine: from === this.self }];
    if (this.chat.length > CHAT_HISTORY) this.chat = this.chat.slice(-CHAT_HISTORY);
  }

  private fail(error: LobbyError): void {
    this.phase = 'error';
    this.error = error;
    this.members = [];
    this.hosting = false;
    this.chat = [];
  }
}
