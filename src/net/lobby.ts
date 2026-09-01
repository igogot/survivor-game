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

/**
 * The run a lobby turned into.
 *
 * Handed to whoever is listening the moment the host presses start, and it is
 * everything a machine needs to join the same world: the seed it is built from,
 * the roster in seat order, and which of those seats is this machine's.
 */
export interface LobbyStart {
  readonly seed: number;
  readonly members: readonly string[];
  /**
   * What each of them is bringing, in the same order.
   *
   * `World` takes exactly this — one weapon id per player — so a party run is
   * built the way a solo run is, and every machine builds the same one because
   * the list travels with the seed rather than being asked for afterwards.
   */
  readonly starters: readonly string[];
  readonly seat: number;
  readonly hosting: boolean;
  /** The room, because signalling is addressed within one. */
  readonly code: string;
  /** This machine's own id, which is how the other end will name it. */
  readonly self: string;
}

/** Why a join did not happen, in the terms a player would put it. */
export type LobbyError = 'notFound' | 'full' | 'closed';

export type LobbyMessage =
  /**
   * A knock, and afterwards a change of mind.
   *
   * The same message does both because it carries the same fact — who I am and
   * what I am bringing — and a second message for the second case would be a
   * second thing to keep in step with the first. A `hello` from somebody the
   * host already has a seat for is not a new arrival; it is that player saying
   * they have swapped weapons.
   */
  | { readonly kind: 'hello'; readonly code: string; readonly from: string; readonly starter: string }
  | {
      readonly kind: 'roster';
      readonly code: string;
      readonly members: readonly string[];
      readonly starters: readonly string[];
    }
  | { readonly kind: 'full'; readonly code: string; readonly to: string }
  | { readonly kind: 'bye'; readonly code: string; readonly from: string }
  | { readonly kind: 'closed'; readonly code: string }
  | { readonly kind: 'chat'; readonly code: string; readonly from: string; readonly text: string }
  | {
      readonly kind: 'begin';
      readonly code: string;
      readonly seed: number;
      readonly members: readonly string[];
      readonly starters: readonly string[];
    }
  /*
   * Two browsers introducing themselves.
   *
   * These ride the lobby's channel and are none of the lobby's business — see
   * the note on `receive`. They are addressed, which nothing else here is: an
   * offer is for one person, and a room of four would otherwise have everybody
   * answering everybody.
   */
  | {
      readonly kind: 'offer';
      readonly code: string;
      readonly from: string;
      readonly to: string;
      readonly sdp: string;
    }
  | {
      readonly kind: 'answer';
      readonly code: string;
      readonly from: string;
      readonly to: string;
      readonly sdp: string;
    }
  | {
      readonly kind: 'ice';
      readonly code: string;
      readonly from: string;
      readonly to: string;
      readonly candidate: string;
      readonly mid: string | null;
    };

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

/**
 * The three that are an introduction rather than a room.
 *
 * Named as their own type so `webrtc.ts` can take one and know what it has:
 * narrowing the whole union again inside every branch there would be the same
 * check written twice with two chances to disagree.
 */
export type SignalMessage = Extract<LobbyMessage, { kind: 'offer' | 'answer' | 'ice' }>;

export function isSignal(message: LobbyMessage): message is SignalMessage {
  return message.kind === 'offer' || message.kind === 'answer' || message.kind === 'ice';
}

export interface LobbyState {
  readonly phase: LobbyPhase;
  /** The team's code once there is one, or '' while there is not. */
  readonly code: string;
  /** Everyone in the room, host first. Empty until a roster arrives. */
  readonly members: readonly string[];
  /** What each of them is bringing, in the same order as `members`. */
  readonly starters: readonly string[];
  /**
   * This player's own choice.
   *
   * Held apart from the roster because it is answerable before there is a
   * roster to hold it: somebody can pick a weapon, then create a team, and the
   * choice has to survive the gap.
   */
  readonly starter: string;
  readonly self: string;
  readonly hosting: boolean;
  readonly error: LobbyError | null;
  /** What has been said in this room, oldest first. */
  readonly chat: readonly ChatLine[];
}

export class Lobby {
  private phase: LobbyPhase = 'idle';
  private code = '';
  /**
   * The roster, as two arrays rather than one array of pairs.
   *
   * `members[i]` and `starters[i]` are one person. They are only ever written
   * together, by the four methods below, and on a guest they are only ever
   * copied from what the host sent — so there is one writer and no chance of
   * the two drifting apart.
   *
   * Keeping the ids a plain `string[]` is the reason for the shape. It is what
   * `PeerMesh`, `HostSession` and the seat lookup in `main.ts` all take, and
   * wrapping each member in an object to save one array here would have
   * rippled through every one of them for no gain.
   */
  private members: string[] = [];
  private starters: string[] = [];
  private hosting = false;
  private error: LobbyError | null = null;
  private chat: ChatLine[] = [];

  readonly self: string;

  /**
   * `send` puts a message where everyone else in the room will see it, and
   * `random` makes codes and identities. Both are handed in so that a test can
   * run two lobbies against a shared array and know what code it will get.
   */
  /**
   * Called once, on everybody, when the host starts the run.
   *
   * A callback rather than a phase, because starting is not a state a lobby
   * sits in — it is the moment the lobby stops being the thing in charge and
   * hands over to a session.
   */
  onStart: ((start: LobbyStart) => void) | null = null;

  /**
   * `starter` is what this player opens with until they say otherwise.
   *
   * Handed in rather than imported so this file keeps knowing nothing about
   * what a weapon is. To the lobby a starter is a string it carries from one
   * machine to another; the only thing that has to agree about its meaning is
   * `World`, which resolves an id it does not recognise to the bolt rather than
   * failing — so a garbled one costs a player their choice and nothing else.
   */
  constructor(
    private readonly send: (message: LobbyMessage) => void,
    private readonly random: () => number,
    private starter: string,
  ) {
    this.self = makeMemberId(random);
  }

  /**
   * Turns the room into a run.
   *
   * Only the host may, and only with somebody else in the room: a team of one
   * is a solo run with extra steps, and the opening screen already has one of
   * those. The seed travels so that everybody's world is built the same way —
   * only the host steps it, but a guest whose `World` disagreed about which
   * weapons exist would draw the wrong figures.
   */
  begin(): void {
    if (this.phase !== 'hosting' || this.members.length < 2) return;

    const seed = Math.floor(this.random() * 0xffffffff);
    this.send({
      kind: 'begin',
      code: this.code,
      seed,
      members: this.members,
      starters: this.starters,
    });
    this.start(seed, this.members, this.starters);
  }

  state(): LobbyState {
    return {
      phase: this.phase,
      code: this.code,
      members: this.members,
      starters: this.starters,
      starter: this.starter,
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
    this.starters = [this.starter];
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
    this.starters = [];
    this.hosting = false;
    this.error = null;
    this.chat = [];
    this.phase = 'joining';
    this.send({ kind: 'hello', code, from: this.self, starter: this.starter });
  }

  /**
   * Picks what this player brings, and tells the room.
   *
   * Kept here rather than in the view because the choice has to survive being
   * sent: the host's copy of the roster is what the world is built from, and
   * the only way a guest's weapon reaches that copy is a message. A player who
   * changes their mind in the waiting room says so the same way they said it
   * when they arrived — see `hello`.
   *
   * Answerable at any point, including before there is a room. Somebody who
   * picks a weapon and then creates a team creates it holding that weapon.
   */
  choose(starter: string): void {
    if (starter === this.starter) return;
    this.starter = starter;

    if (this.hosting) {
      // The host is not a message to itself. It edits its own seat and
      // republishes, which is the same thing `admit` does for everybody else.
      this.starters = this.starters.map((had, seat) =>
        this.members[seat] === this.self ? starter : had,
      );
      this.publish();
    } else if (this.phase === 'joined' || this.phase === 'joining') {
      this.send({ kind: 'hello', code: this.code, from: this.self, starter });
    }
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
    this.starters = [];
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
        this.admit(message.from, message.starter);
        break;
      case 'roster':
        this.adopt(message.members, message.starters);
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
      case 'begin':
        // Only from a room this lobby is a guest in, and only for somebody it
        // has a seat for. A host ignores it: it already started itself.
        if (!this.hosting && message.members.includes(this.self)) {
          this.start(message.seed, message.members, message.starters);
        }
        break;
      // Signalling shares this channel because it needs the same reach and the
      // same room, and it would be a second delivery mechanism for no gain. The
      // lobby has nothing to say about it: who is connecting to whom is
      // `webrtc.ts`'s business, and a state machine that also tracked peer
      // connections would be two features wearing one name.
      case 'offer':
      case 'answer':
      case 'ice':
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

  private admit(from: string, starter: string): void {
    if (!this.hosting || from === this.self) return;

    const seat = this.members.indexOf(from);
    if (seat === -1) {
      if (this.members.length >= MAX_PARTY) {
        this.send({ kind: 'full', code: this.code, to: from });
        return;
      }
      this.members = [...this.members, from];
      this.starters = [...this.starters, starter];
    } else {
      // Somebody already in the room, so this is a change of weapon rather than
      // an arrival. Their seat does not move: a roster that reordered itself
      // every time somebody browsed the cards would renumber the whole team.
      this.starters = this.starters.map((had, index) => (index === seat ? starter : had));
    }

    // Answered even when they were already on the list: a guest re-knocking is
    // a guest who did not hear the first answer.
    this.publish();
  }

  private adopt(members: readonly string[], starters: readonly string[]): void {
    if (this.hosting || !members.includes(this.self)) return;
    this.members = [...members];
    this.starters = [...starters];
    this.phase = 'joined';
    this.error = null;
  }

  private dismiss(from: string): void {
    if (!this.hosting) return;

    const seat = this.members.indexOf(from);
    if (seat === -1) return;

    this.members = this.members.filter((_, index) => index !== seat);
    this.starters = this.starters.filter((_, index) => index !== seat);
    this.publish();
  }

  /** The roster as the host has it, which is the only copy that decides. */
  private publish(): void {
    this.send({
      kind: 'roster',
      code: this.code,
      members: this.members,
      starters: this.starters,
    });
  }

  private start(seed: number, members: readonly string[], starters: readonly string[]): void {
    this.onStart?.({
      seed,
      members,
      starters,
      seat: members.indexOf(this.self),
      hosting: this.hosting,
      code: this.code,
      self: this.self,
    });
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
    this.starters = [];
    this.hosting = false;
    this.chat = [];
  }
}
