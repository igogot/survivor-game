import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, isCode, makeCode, normaliseCode } from '../src/net/code';
import { CHAT_HISTORY, Lobby, MAX_PARTY, MAX_SAID } from '../src/net/lobby';
import type { LobbyMessage, LobbyStart } from '../src/net/lobby';

/**
 * The waiting room, driven the way two browser windows would drive it.
 *
 * `Lobby` has no timers, no DOM and no channel, so a test can be the channel:
 * a list of lobbies and a `send` that hands every message to all of them. That
 * is the same shape `BroadcastChannel` has — everyone hears everything,
 * including themselves — so what passes here is what happens on the page.
 */

/** Deterministic randomness: the codes a test gets are the codes it expects. */
function counter(start = 0): () => number {
  let n = start;
  return () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
}

/** A room everyone shouts into, and a way to add another person to it. */
function room(): {
  join: (seed?: number, starter?: string) => Lobby;
  sent: LobbyMessage[];
} {
  const members: Lobby[] = [];
  const sent: LobbyMessage[] = [];

  const send = (message: LobbyMessage): void => {
    sent.push(message);
    // A copy of the list, because a lobby may leave while being delivered to.
    for (const member of [...members]) member.receive(message);
  };

  return {
    sent,
    join(seed = members.length + 1, starter = 'bolt') {
      const lobby = new Lobby(send, counter(seed), starter);
      members.push(lobby);
      return lobby;
    },
  };
}

describe('team codes', () => {
  it('is six characters from an alphabet with no lookalikes', () => {
    const code = makeCode(counter(7));

    expect(code).toHaveLength(CODE_LENGTH);
    expect(isCode(code)).toBe(true);
    for (const forbidden of ['O', 'I', 'L', '0', '1', '5', 'S']) {
      expect(CODE_ALPHABET, forbidden).not.toContain(forbidden);
    }
  });

  it('forgives the way a code gets written down', () => {
    expect(normaliseCode(' 2b4-d6 h ')).toBe('2B4D6H');
  });

  /**
   * A `0` in a code drawn from an alphabet with no `0` means it was misread.
   * Dropping it would turn a wrong code into a differently wrong one, five
   * characters long, and the player would be told the room does not exist
   * rather than that they mistyped.
   */
  it('refuses a character the alphabet does not have', () => {
    expect(isCode('2B4D6O')).toBe(false);
    expect(isCode('2B4D6')).toBe(false);
    expect(isCode('2B4D6HH')).toBe(false);
  });

  it('does not hand out the same code twice in a row', () => {
    const random = counter(3);
    const codes = new Set(Array.from({ length: 20 }, () => makeCode(random)));

    expect(codes.size).toBe(20);
  });
});

describe('a waiting room', () => {
  it('starts idle and holds nothing', () => {
    const state = room().join().state();

    expect(state.phase).toBe('idle');
    expect(state.code).toBe('');
    expect(state.members).toHaveLength(0);
  });

  it('opens a room and puts the host in it', () => {
    const host = room().join();
    const code = host.host();

    expect(isCode(code)).toBe(true);
    expect(host.state().phase).toBe('hosting');
    expect(host.state().hosting).toBe(true);
    expect(host.state().members).toEqual([host.self]);
  });

  it('lets somebody in on the code and shows them to each other', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    const code = host.host();
    guest.join(code);

    expect(guest.state().phase).toBe('joined');
    expect(guest.state().members).toEqual([host.self, guest.self]);
    expect(host.state().members).toEqual([host.self, guest.self]);
    expect(guest.state().hosting).toBe(false);
  });

  /** The whole point of a code: it is the only way in. */
  it('ignores a knock on a code nobody is holding', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    host.host();
    guest.join('ZZZZZZ');

    expect(guest.state().phase).toBe('joining');
    expect(host.state().members).toEqual([host.self]);

    guest.giveUp();
    expect(guest.state().phase).toBe('error');
    expect(guest.state().error).toBe('notFound');
  });

  it('keeps two teams on one channel apart', () => {
    const shared = room();
    const hostA = shared.join(1);
    const hostB = shared.join(2);
    const guest = shared.join(3);

    hostA.host();
    const codeB = hostB.host();
    guest.join(codeB);

    expect(hostB.state().members).toEqual([hostB.self, guest.self]);
    expect(hostA.state().members).toEqual([hostA.self]);
  });

  it('fills to four and turns the fifth away', () => {
    const shared = room();
    const host = shared.join();
    const code = host.host();

    const guests = Array.from({ length: MAX_PARTY }, () => shared.join());
    for (const guest of guests) guest.join(code);

    expect(host.state().members).toHaveLength(MAX_PARTY);
    for (const guest of guests.slice(0, MAX_PARTY - 1)) {
      expect(guest.state().phase).toBe('joined');
    }

    const late = guests[MAX_PARTY - 1];
    expect(late.state().phase).toBe('error');
    expect(late.state().error).toBe('full');
  });

  it('frees the seat when somebody walks out', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    const code = host.host();
    guest.join(code);
    guest.leave();

    expect(host.state().members).toEqual([host.self]);
    expect(guest.state().phase).toBe('idle');
  });

  /**
   * A host leaving closes the room rather than handing it on. Migrating the
   * host is a real feature with real failure modes, and a room that has not
   * started anything is the one place where "everybody go again" is honest.
   */
  it('closes the room when the host leaves', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    const code = host.host();
    guest.join(code);
    host.leave();

    expect(guest.state().phase).toBe('error');
    expect(guest.state().error).toBe('closed');
    expect(host.state().phase).toBe('idle');
  });

  /** A guest who did not hear the first answer knocks again. */
  it('answers a second knock without seating anybody twice', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    const code = host.host();
    guest.join(code);
    guest.join(code);

    expect(host.state().members).toEqual([host.self, guest.self]);
  });

  /** Nobody hears anything before they are in a room. */
  it('ignores everything while idle', () => {
    const shared = room();
    const host = shared.join();
    const bystander = shared.join();

    const code = host.host();
    shared.join().join(code);

    expect(bystander.state().phase).toBe('idle');
    expect(bystander.state().members).toHaveLength(0);
  });

  it('forgets what was said in the room before', () => {
    const shared = room();
    const host = shared.join();

    host.host();
    host.say('first room');
    host.leave();
    host.host();

    expect(host.state().chat).toHaveLength(0);
  });

  it('gives everyone in the room the same list in the same order', () => {
    const shared = room();
    const host = shared.join();
    const first = shared.join();
    const second = shared.join();

    const code = host.host();
    first.join(code);
    second.join(code);

    expect(first.state().members).toEqual(host.state().members);
    expect(second.state().members).toEqual(host.state().members);
    expect(host.state().members[0]).toBe(host.self);
  });
});

/**
 * What each player brings.
 *
 * A party run is built from one weapon id per seat, and those ids have to reach
 * the machine doing the building. So the choice is a fact about the room like
 * the roster is, kept by the host and republished — not something each screen
 * decides for itself, which would give four machines four different worlds.
 */
describe('what each player brings', () => {
  it('arrives with the knock', () => {
    const shared = room();
    const host = shared.join(1, 'orbit');
    const guest = shared.join(2, 'nova');

    guest.join(host.host());

    expect(host.state().starters).toEqual(['orbit', 'nova']);
    expect(guest.state().starters).toEqual(['orbit', 'nova']);
  });

  /**
   * The waiting room is where a team looks at what everybody picked and argues
   * about it, so changing your mind there has to work — and has to reach the
   * host, because the host's list is the one the world is built from.
   */
  it('can be changed from the waiting room', () => {
    const shared = room();
    const host = shared.join(1);
    const guest = shared.join(2);

    guest.join(host.host());
    guest.choose('harpoon');

    expect(host.state().starters).toEqual(['bolt', 'harpoon']);
    expect(guest.state().starters).toEqual(['bolt', 'harpoon']);
  });

  it('can be changed by the host, who has nobody to ask', () => {
    const shared = room();
    const host = shared.join(1);
    const guest = shared.join(2);

    guest.join(host.host());
    host.choose('ember');

    expect(guest.state().starters).toEqual(['ember', 'bolt']);
  });

  /** A second hello is a change of weapon, not a second seat. */
  it('does not seat somebody twice for changing their mind', () => {
    const shared = room();
    const host = shared.join(1);
    const guest = shared.join(2);

    guest.join(host.host());
    guest.choose('nova');
    guest.choose('spear');

    expect(host.state().members).toEqual([host.self, guest.self]);
    expect(host.state().starters).toEqual(['bolt', 'spear']);
  });

  /**
   * And it does not move anybody. A roster that reordered itself every time
   * somebody browsed the cards would renumber the whole team mid-sentence.
   */
  it('leaves everybody in the seat they took', () => {
    const shared = room();
    const host = shared.join(1);
    const first = shared.join(2);
    const second = shared.join(3);

    const code = host.host();
    first.join(code);
    second.join(code);
    first.choose('nova');

    expect(host.state().members).toEqual([host.self, first.self, second.self]);
    expect(host.state().starters).toEqual(['bolt', 'nova', 'bolt']);
  });

  it('is remembered from before there was a room', () => {
    const shared = room();
    const host = shared.join(1);

    host.choose('orbit');
    host.host();

    expect(host.state().starters).toEqual(['orbit']);
    expect(host.state().starter).toBe('orbit');
  });

  /** Leaving takes a weapon off the list with the player holding it. */
  it('goes when its owner does', () => {
    const shared = room();
    const host = shared.join(1);
    const first = shared.join(2);
    const second = shared.join(3);

    const code = host.host();
    first.join(code);
    second.join(code);
    first.choose('nova');
    second.choose('spear');
    first.leave();

    expect(host.state().members).toEqual([host.self, second.self]);
    expect(host.state().starters).toEqual(['bolt', 'spear']);
  });
});

/**
 * The moment the room stops being a room.
 *
 * Everything a machine needs to build the same world as everybody else travels
 * in one message, because a world assembled from two sources is a world two
 * machines can disagree about.
 */
describe('turning the room into a run', () => {
  it('hands everybody the same seed, roster and weapons', () => {
    const shared = room();
    const host = shared.join(1);
    const guest = shared.join(2);

    const starts: LobbyStart[] = [];
    host.onStart = (start) => starts.push(start);
    guest.onStart = (start) => starts.push(start);

    guest.join(host.host());
    guest.choose('harpoon');
    host.begin();

    expect(starts).toHaveLength(2);

    // Picked out by who they are for rather than by arrival order. The host
    // tells the room before it tells itself, so the guest's start lands first —
    // which is an implementation detail and not a thing to hold a test to.
    const forHost = starts.find((start) => start.hosting);
    const forGuest = starts.find((start) => !start.hosting);
    if (forHost === undefined || forGuest === undefined) {
      throw new Error('both ends should have started');
    }

    expect(forHost.seed).toBe(forGuest.seed);
    expect(forHost.members).toEqual(forGuest.members);
    expect(forHost.starters).toEqual(['bolt', 'harpoon']);
    expect(forGuest.starters).toEqual(['bolt', 'harpoon']);

    // Same list, and each machine knows which of the seats is its own.
    expect(forHost.seat).toBe(0);
    expect(forGuest.seat).toBe(1);
    expect(forHost.hosting).toBe(true);
    expect(forGuest.hosting).toBe(false);
  });

  /** A team of one is a solo run with extra steps, and there is one of those. */
  it('refuses to start a team of one', () => {
    const shared = room();
    const host = shared.join(1);

    let started = 0;
    host.onStart = () => started++;
    host.host();
    host.begin();

    expect(started).toBe(0);
  });

  it('is the host’s to press', () => {
    const shared = room();
    const host = shared.join(1);
    const guest = shared.join(2);

    let started = 0;
    host.onStart = () => started++;
    guest.onStart = () => started++;

    guest.join(host.host());
    guest.begin();

    expect(started).toBe(0);
  });
});

/**
 * Talking in the room.
 *
 * A chat line is not a fact two people could disagree on, so it does not go
 * through the host the way the roster does — everyone keeps a log of what
 * reached them. What that costs is written down rather than hidden: somebody
 * who joins late did not hear what came before, and there is no history to
 * hand them that would not be invented.
 */
describe('talking in the room', () => {
  it('says nothing until there is a room to say it in', () => {
    const lobby = room().join();
    lobby.say('anybody there');

    expect(lobby.state().chat).toHaveLength(0);
  });

  it('shows a line to everybody in the room, once', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    const code = host.host();
    guest.join(code);
    host.say('ready?');

    expect(host.state().chat).toEqual([{ seat: 0, text: 'ready?', mine: true }]);
    expect(guest.state().chat).toEqual([{ seat: 0, text: 'ready?', mine: false }]);
  });

  /**
   * A broadcast does not come back to whoever made it, so the sender puts their
   * own words on their own screen — and a transport that *does* echo must not
   * then show them twice. This harness echoes, which is the harder case.
   */
  it('never doubles a line for the person who said it', () => {
    const shared = room();
    const host = shared.join();
    host.host();

    host.say('hello');

    expect(host.state().chat).toHaveLength(1);
  });

  it('keeps the room in the order it was said', () => {
    const shared = room();
    const host = shared.join();
    const guest = shared.join();

    const code = host.host();
    guest.join(code);

    host.say('one');
    guest.say('two');
    host.say('three');

    expect(guest.state().chat.map((line) => line.text)).toEqual(['one', 'two', 'three']);
    expect(guest.state().chat.map((line) => line.seat)).toEqual([0, 1, 0]);
  });

  it('ignores a stray Enter on an empty field', () => {
    const shared = room();
    const host = shared.join();
    host.host();

    host.say('');
    host.say('   ');

    expect(host.state().chat).toHaveLength(0);
  });

  it('trims what is said and caps how much of it there is', () => {
    const shared = room();
    const host = shared.join();
    host.host();

    host.say('  spaced  ');
    host.say('x'.repeat(MAX_SAID + 50));

    expect(host.state().chat[0].text).toBe('spaced');
    expect(host.state().chat[1].text).toHaveLength(MAX_SAID);
  });

  /** A code is a shared secret; somebody outside the roster is not in the room. */
  it('refuses a line from somebody who is not in the team', () => {
    const shared = room();
    const host = shared.join();
    const code = host.host();

    host.receive({ kind: 'chat', code, from: 'STRANGER', text: 'let me in' });

    expect(host.state().chat).toHaveLength(0);
  });

  it('does not carry a line into another team on the same channel', () => {
    const shared = room();
    const hostA = shared.join(1);
    const hostB = shared.join(2);

    hostA.host();
    hostB.host();
    hostA.say('ours');

    expect(hostB.state().chat).toHaveLength(0);
  });

  it('keeps a bounded log', () => {
    const shared = room();
    const host = shared.join();
    host.host();

    for (let i = 0; i < CHAT_HISTORY + 10; i++) host.say(`line ${i}`);

    const chat = host.state().chat;
    expect(chat).toHaveLength(CHAT_HISTORY);
    expect(chat[chat.length - 1].text).toBe(`line ${CHAT_HISTORY + 9}`);
  });

  /**
   * A log is a record of what was said, so a line keeps the seat it was said
   * from even after the roster shifts under it.
   */
  it('does not relabel history when somebody leaves', () => {
    const shared = room();
    const host = shared.join();
    const first = shared.join();
    const second = shared.join();

    const code = host.host();
    first.join(code);
    second.join(code);

    second.say('mine');
    expect(host.state().chat[0].seat).toBe(2);

    first.leave();
    expect(host.state().chat[0].seat).toBe(2);
  });
});
