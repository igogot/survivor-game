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
 */

/** Four, which is what the world can hold. See `World`'s constructor. */
export const MAX_PARTY = 4;

export type LobbyPhase = 'idle' | 'hosting' | 'joining' | 'joined' | 'error';

/** Why a join did not happen, in the terms a player would put it. */
export type LobbyError = 'notFound' | 'full' | 'closed';

export type LobbyMessage =
  | { readonly kind: 'hello'; readonly code: string; readonly from: string }
  | { readonly kind: 'roster'; readonly code: string; readonly members: readonly string[] }
  | { readonly kind: 'full'; readonly code: string; readonly to: string }
  | { readonly kind: 'bye'; readonly code: string; readonly from: string }
  | { readonly kind: 'closed'; readonly code: string };

export interface LobbyState {
  readonly phase: LobbyPhase;
  /** The team's code once there is one, or '' while there is not. */
  readonly code: string;
  /** Everyone in the room, host first. Empty until a roster arrives. */
  readonly members: readonly string[];
  readonly self: string;
  readonly hosting: boolean;
  readonly error: LobbyError | null;
}

export class Lobby {
  private phase: LobbyPhase = 'idle';
  private code = '';
  private members: string[] = [];
  private hosting = false;
  private error: LobbyError | null = null;

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
    };
  }

  /** Opens a room and answers with its code, which is the thing to read out. */
  host(): string {
    this.code = makeCode(this.random);
    this.members = [this.self];
    this.hosting = true;
    this.error = null;
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

  private fail(error: LobbyError): void {
    this.phase = 'error';
    this.error = error;
    this.members = [];
    this.hosting = false;
  }
}
