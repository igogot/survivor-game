import { diagnose } from './diagnosis';
import type { AttemptFacts, Diagnosis } from './diagnosis';
import { isSignal } from './lobby';
import type { LobbyMessage, SignalMessage } from './lobby';
import type { Envelope } from './mailbox';
import type { NetMessage } from './session';

/**
 * Two browsers talking to each other directly.
 *
 * Everything up to this point travels through something in the middle — a
 * broadcast the operating system carries, or a table on a shared host. Neither
 * can carry a run: a snapshot is four kilobytes twenty times a second, and
 * posting that to a shared plan would be unkind to the host and unplayable for
 * everybody. So the run goes peer to peer, and this is the introduction.
 *
 * The shape is the same star the rest of the netcode assumes: every guest opens
 * one connection to the host and none to each other. That is fewer connections
 * than a mesh — three instead of six for a party of four — and it matches who
 * actually needs to talk to whom, since the host is the only machine with a
 * world in it.
 *
 * **STUN only, and no relay.** A public STUN server is free and costs one small
 * request; a TURN relay carries the whole run and is billed by the gigabyte,
 * which this project does not have. The consequence is written down rather than
 * hidden: where a router hands out a different external port for every
 * destination — which is most mobile networks — the address the two sides
 * exchanged is wrong before it is sent, and no amount of retrying fixes it.
 * `diagnosis.ts` is what turns that from a mystery into a sentence.
 *
 * Signalling rides the lobby's channel. It needs the same reach and the same
 * room, and a second delivery mechanism for three messages would be three
 * things to keep working instead of one.
 */

/**
 * Where to ask what your own address looks like from outside.
 *
 * Google's public servers, which is what almost everything on the web uses.
 * Two of them because one is a single point of failure for a service whose
 * whole job is to be reachable.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/**
 * How long to wait before calling it.
 *
 * ICE gives up on its own eventually, but slowly and without saying much. This
 * is short enough that a player is not left watching a spinner and long enough
 * that a phone on a slow network is not written off while it is still trying.
 */
const ATTEMPT_TIMEOUT_MS = 12_000;

/** One connection's state, as the interface needs to show it. */
export type LinkState = 'connecting' | 'open' | 'failed';

export interface LinkReport {
  readonly member: string;
  readonly state: LinkState;
  readonly diagnosis: Diagnosis | null;
}

/**
 * All of this machine's connections to the others.
 *
 * The host opens one per guest and a guest opens one to the host, but the two
 * differ by so little that they are one class: who makes the offer, and who
 * waits for one.
 */
export class PeerMesh {
  private readonly links = new Map<string, Link>();

  constructor(
    private readonly self: string,
    private readonly code: string,
    /** Puts a signalling message where the other end will see it. */
    private readonly signal: (message: LobbyMessage) => void,
    /** Called with everything that arrives from anybody, once it is open. */
    private readonly onMessage: (message: Envelope<NetMessage>) => void,
    /** Called whenever a link changes state, so the interface can say so. */
    private readonly onChange: () => void,
  ) {}

  /** Whether anything at all is carrying traffic. */
  get open(): boolean {
    for (const link of this.links.values()) {
      if (link.state === 'open') return true;
    }
    return false;
  }

  report(): readonly LinkReport[] {
    return [...this.links.entries()].map(([member, link]) => ({
      member,
      state: link.state,
      diagnosis: link.diagnosis,
    }));
  }

  /**
   * Calls somebody. The host does this for each guest when the run begins.
   *
   * The caller makes the data channel; the answerer is handed it. Both ends
   * being allowed to create one is how a connection ends up with two.
   */
  invite(member: string): void {
    if (this.links.has(member) || member === this.self) return;

    const link = this.make(member, true);
    void link.offer();
  }

  /** Everything arriving on the signalling channel that is addressed here. */
  receive(message: LobbyMessage): void {
    if (!isSignal(message)) return;
    if (message.code !== this.code || message.to !== this.self) return;

    const existing = this.links.get(message.from);
    // An offer from somebody unknown is a guest arriving; anything else from
    // somebody unknown is late post from a connection that is already gone.
    const link = existing ?? (message.kind === 'offer' ? this.make(message.from, false) : null);
    if (link === null) return;

    void link.handle(message);
  }

  /** Sends to everybody this machine is connected to. */
  broadcast(message: Envelope<NetMessage>): void {
    for (const link of this.links.values()) link.send(message);
  }

  close(): void {
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }

  private make(member: string, caller: boolean): Link {
    const link = new Link(
      this.self,
      member,
      this.code,
      caller,
      this.signal,
      this.onMessage,
      this.onChange,
    );
    this.links.set(member, link);
    return link;
  }
}

/**
 * One connection to one other person.
 *
 * Everything the browser tells us on the way is kept, because none of it is
 * worth anything on its own and all of it together is the difference between
 * "it did not work" and "your router will not do this, let somebody else make
 * the team".
 */
class Link {
  state: LinkState = 'connecting';
  diagnosis: Diagnosis | null = null;

  private readonly peer: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private readonly facts: { -readonly [K in keyof AttemptFacts]: AttemptFacts[K] };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly self: string,
    private readonly member: string,
    private readonly code: string,
    caller: boolean,
    private readonly signal: (message: LobbyMessage) => void,
    private readonly onMessage: (message: Envelope<NetMessage>) => void,
    private readonly onChange: () => void,
  ) {
    this.facts = {
      everConnected: false,
      sawPublicAddress: false,
      heardFromPeer: false,
      hosting: caller,
    };

    this.peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.peer.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (candidate === null) return;

      // `srflx` is a candidate STUN handed back: proof that this end found out
      // what it looks like from outside. Not having one is its own diagnosis.
      if (candidate.type === 'srflx') this.facts.sawPublicAddress = true;

      this.signal({
        kind: 'ice',
        code: this.code,
        from: this.self,
        to: this.member,
        candidate: candidate.candidate,
        mid: candidate.sdpMid,
      });
    };

    this.peer.onconnectionstatechange = () => this.settle();

    if (caller) {
      // Unordered and unreliable: a snapshot is the whole picture, so one that
      // arrives late is worth less than the one behind it, and waiting for a
      // lost packet to be resent would hold up the newer one behind it. This is
      // the whole reason the format is a full snapshot rather than a patch.
      this.adopt(this.peer.createDataChannel('run', { ordered: false, maxRetransmits: 0 }));
    } else {
      this.peer.ondatachannel = (event) => this.adopt(event.channel);
    }

    this.timer = setTimeout(() => this.fail(), ATTEMPT_TIMEOUT_MS);
  }

  async offer(): Promise<void> {
    try {
      const description = await this.peer.createOffer();
      await this.peer.setLocalDescription(description);
      this.signal({
        kind: 'offer',
        code: this.code,
        from: this.self,
        to: this.member,
        sdp: description.sdp ?? '',
      });
    } catch {
      this.fail();
    }
  }

  async handle(message: SignalMessage): Promise<void> {
    this.facts.heardFromPeer = true;

    try {
      if (message.kind === 'offer') {
        await this.peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        this.signal({
          kind: 'answer',
          code: this.code,
          from: this.self,
          to: this.member,
          sdp: answer.sdp ?? '',
        });
        return;
      }

      if (message.kind === 'answer') {
        await this.peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        return;
      }

      await this.peer.addIceCandidate({
        candidate: message.candidate,
        sdpMid: message.mid,
      });
    } catch {
      // A candidate that arrives before the description it belongs to throws,
      // and ICE will try the rest anyway. Failing the whole link over one of
      // them would give up on a connection that was still forming.
    }
  }

  send(message: Envelope<NetMessage>): void {
    if (this.channel?.readyState !== 'open') return;

    try {
      this.channel.send(JSON.stringify(message, replacer));
    } catch {
      // A full send buffer on an unreliable channel is a dropped snapshot, and
      // a dropped snapshot is what the next one is for.
    }
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.channel?.close();
    this.peer.close();
  }

  private adopt(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => {
      this.facts.everConnected = true;
      this.state = 'open';
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.onChange();
    };
    channel.onclose = () => this.settle();
    channel.onmessage = (event: MessageEvent<string>) => {
      const message = parse(event.data);
      if (message !== null) this.onMessage(message);
    };
  }

  private settle(): void {
    const state = this.peer.connectionState;
    if (state === 'connected') {
      this.facts.everConnected = true;
      return;
    }
    if (state === 'failed' || state === 'closed' || state === 'disconnected') this.fail();
  }

  private fail(): void {
    if (this.state === 'failed') return;

    this.state = 'failed';
    this.diagnosis = diagnose(this.facts);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.onChange();
  }
}

/**
 * JSON, with the snapshot's bytes surviving it.
 *
 * A data channel would carry an `ArrayBuffer` directly and it would be smaller,
 * but a channel that carried two kinds of thing would need a header to say
 * which — and the messages that are not snapshots are small, rare and much
 * easier to read as text when something goes wrong. Base64 costs a third on
 * top of four kilobytes, which is the cheapest debuggability in this file.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return { $bytes: btoa(binary) };
  }
  return value;
}

function parse(raw: string): Envelope<NetMessage> | null {
  try {
    return JSON.parse(raw, (_key, value: unknown) => {
      if (typeof value === 'object' && value !== null && '$bytes' in value) {
        const binary = atob(String((value as { $bytes: unknown }).$bytes));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      return value;
    }) as Envelope<NetMessage>;
  } catch {
    return null;
  }
}
