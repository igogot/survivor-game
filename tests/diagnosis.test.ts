import { describe, expect, it } from 'vitest';
import { diagnose, shouldSwapHost } from '../src/net/diagnosis';
import type { AttemptFacts } from '../src/net/diagnosis';

/**
 * What a player is told when two browsers cannot reach each other.
 *
 * This is the one part of the peer-to-peer layer that can be checked without a
 * browser, and it is also the part most worth checking: the connection either
 * happens or it does not, but what the game *says* about it is a decision, and
 * a wrong sentence sends somebody to change a setting that was never the
 * problem.
 */

function facts(over: Partial<AttemptFacts> = {}): AttemptFacts {
  return {
    everConnected: false,
    sawPublicAddress: true,
    heardFromPeer: true,
    hosting: false,
    ...over,
  };
}

describe('why it did not connect', () => {
  /**
   * It worked and then stopped. A closed laptop or a tunnel — nothing about the
   * shape of the network is to blame, and telling somebody to change networks
   * over this would send them after the wrong thing.
   */
  it('calls a connection that worked and stopped a drop', () => {
    expect(diagnose(facts({ everConnected: true }))).toBe('dropped');
    // Even when everything else looks like the hopeless case.
    expect(
      diagnose(facts({ everConnected: true, sawPublicAddress: false, heardFromPeer: false })),
    ).toBe('dropped');
  });

  /**
   * The other side never said anything. That is not a NAT problem at all — it
   * is somebody who is not in the room, or post that is not moving.
   */
  it('separates silence from refusal', () => {
    expect(diagnose(facts({ heardFromPeer: false }))).toBe('noSignalling');
  });

  /** No public address of one's own means UDP is not leaving the building. */
  it('names a network that will not let anything out', () => {
    expect(diagnose(facts({ sawPublicAddress: false }))).toBe('blocked');
  });

  /**
   * Both sides said where they thought they were and nothing got through. This
   * is the symmetric-NAT case — the address a router hands out for one
   * destination is not the one it uses for another, so what was exchanged was
   * wrong before it was sent. It is the one this game cannot fix.
   */
  it('names the case a relay would be needed for', () => {
    expect(diagnose(facts())).toBe('unreachable');
  });
});

describe('who should make the team', () => {
  /**
   * The shape of this game's network is a star: every guest connects to the
   * host and nobody to anybody else. So a guest behind a hostile network is one
   * player who cannot join, and a *host* behind one is a team that cannot form
   * at all — which makes "let somebody else create it" the useful advice rather
   * than "try again".
   */
  it('asks the host to hand the room over when the host is the problem', () => {
    const asHost = facts({ hosting: true });

    expect(shouldSwapHost(asHost, diagnose(asHost))).toBe(true);
    expect(shouldSwapHost(asHost, 'blocked')).toBe(true);
  });

  it('does not, when a guest is the one who cannot get through', () => {
    const asGuest = facts({ hosting: false });

    expect(shouldSwapHost(asGuest, diagnose(asGuest))).toBe(false);
  });

  /** A dropped line says nothing about whose network is worse. */
  it('does not, for a connection that had been working', () => {
    const dropped = facts({ hosting: true, everConnected: true });

    expect(shouldSwapHost(dropped, diagnose(dropped))).toBe(false);
  });
});
