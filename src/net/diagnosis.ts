/**
 * Why a connection did not happen, in words a player can act on.
 *
 * WebRTC fails silently and unhelpfully: `iceConnectionState` goes to
 * `failed` and that is the whole story the browser tells. For somebody sitting
 * in a waiting room that is indistinguishable from a broken game, and they will
 * conclude it is one.
 *
 * It cannot always be fixed. Two machines behind symmetric NAT — which is what
 * most mobile networks give you — genuinely cannot reach each other without a
 * relay to sit in the middle, and this project does not run one. What *can* be
 * done is to stop the failure being a mystery: the browser knows enough to
 * distinguish "nothing got through at all" from "we found each other and then
 * the line dropped", and those two want different things from the player.
 *
 * Kept apart from `webrtc.ts` and given no browser types on purpose. What a
 * player is told is a decision worth testing, and none of it needs an
 * `RTCPeerConnection` to reason about.
 */

/** What the browser could tell us about an attempt that did not work. */
export interface AttemptFacts {
  /** Whether ICE ever nominated a pair — i.e. anything got through at all. */
  readonly everConnected: boolean;
  /**
   * Whether this end managed to find out its own public address.
   *
   * A `srflx` candidate is one STUN handed back. Not having one means the
   * network refused even that, which is a different problem from having one and
   * still not getting through.
   */
  readonly sawPublicAddress: boolean;
  /** Whether the peer offered any address of its own. */
  readonly heardFromPeer: boolean;
  /** True when this machine is the one running the world. */
  readonly hosting: boolean;
}

/**
 * The four outcomes worth telling apart, as the id of the line to print.
 *
 * Ids rather than sentences, because the sentences live in the translation
 * tables with every other line of interface text.
 */
export type Diagnosis =
  | 'dropped'
  | 'noSignalling'
  | 'blocked'
  | 'unreachable';

export function diagnose(facts: AttemptFacts): Diagnosis {
  // It worked and then stopped. Somebody closed a laptop or a train went into
  // a tunnel; nothing about the network's shape is to blame and telling them to
  // change networks would be wrong.
  if (facts.everConnected) return 'dropped';

  // The other side never said anything at all. Either they are not there, or
  // the room's post is not moving — which is a different failure entirely from
  // one of NAT, and the advice for it is to check that both are in the room.
  if (!facts.heardFromPeer) return 'noSignalling';

  // This end could not even learn its own public address, which means UDP is
  // not leaving the building. Corporate and university networks do this.
  if (!facts.sawPublicAddress) return 'blocked';

  // Both sides said where they thought they were and nothing got through. This
  // is the symmetric-NAT case, and it is the one this game cannot fix: the
  // address a router hands out for one destination is not the one it will use
  // for another, so what was exchanged was wrong before it was sent.
  return 'unreachable';
}

/**
 * Whether the party would be better off with somebody else creating the room.
 *
 * Worth its own answer because of the shape of this game's network: every guest
 * connects to the host and nobody connects to anybody else. A guest behind a
 * hostile network is one player who cannot join; a *host* behind one is a team
 * that cannot form at all. So when the host is the end that could not be
 * reached, the useful advice is not "try again" but "let somebody else make the
 * team".
 */
export function shouldSwapHost(facts: AttemptFacts, diagnosis: Diagnosis): boolean {
  return facts.hosting && (diagnosis === 'unreachable' || diagnosis === 'blocked');
}
