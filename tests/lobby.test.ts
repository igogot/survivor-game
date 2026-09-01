import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, isCode, makeCode, normaliseCode } from '../src/net/code';
import { Lobby, MAX_PARTY } from '../src/net/lobby';
import type { LobbyMessage } from '../src/net/lobby';

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
function room(): { join: (seed?: number) => Lobby; sent: LobbyMessage[] } {
  const members: Lobby[] = [];
  const sent: LobbyMessage[] = [];

  const send = (message: LobbyMessage): void => {
    sent.push(message);
    // A copy of the list, because a lobby may leave while being delivered to.
    for (const member of [...members]) member.receive(message);
  };

  return {
    sent,
    join(seed = members.length + 1) {
      const lobby = new Lobby(send, counter(seed));
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
