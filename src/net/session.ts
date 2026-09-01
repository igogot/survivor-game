import { applySnapshot, encodeSnapshot } from './snapshot';
import { nextLiving } from '../world/party';
import { takeSpoil } from '../systems/chests';
import { applyUpgrade } from '../systems/progression';
import type { World } from '../world/world';

/**
 * A run with more than one machine in it.
 *
 * One of them steps the `World` and everybody else draws what it sends. That is
 * the whole architecture, and it was picked over the alternative for a reason
 * this codebase can point at: the simulation is deterministic, so lockstep would
 * have fitted — but JavaScript's `Math.sin` and friends are
 * implementation-approximated by the specification, and two browsers drifting in
 * the last bit would silently fork the two worlds with nothing to notice it. One
 * machine simulating cannot drift from itself.
 *
 * What travels is small and one-directional. Guests send what their hands are
 * doing; the host sends what the world looks like. Nothing a guest sends is
 * trusted as a fact about the world — it is an intent, applied by the host to
 * the player that guest owns, and a guest claiming to be somebody else is
 * simply ignored.
 *
 * There is no prediction here. A guest's own player moves when the next
 * snapshot says so, which over a local channel is invisible and over a real one
 * is a delay to be dealt with later; the honest name for what this does is
 * "snapshot and interpolate", and the interpolation is the renderer's own,
 * because a snapshot leaves the previous position in `px`/`py` on its way past.
 */

/**
 * Snapshots a second.
 *
 * Twenty rather than sixty, because the renderer already interpolates between
 * the last two positions of everything — it was written to smooth a 60 Hz
 * simulation onto a 144 Hz screen and it smooths this for free. Three times
 * fewer snapshots is three times less upstream, which is the number that
 * decides whether a home connection can host four people at all.
 */
export const SNAPSHOT_HZ = 20;

/** The lobby seats its host first, so that is the player this machine drives. */
const HOST_SEAT = 0;

export type NetMessage =
  | { readonly kind: 'snapshot'; readonly bytes: Uint8Array }
  | {
      readonly kind: 'input';
      readonly from: string;
      readonly x: number;
      readonly y: number;
      readonly target: { readonly x: number; readonly y: number } | null;
    }
  | { readonly kind: 'pick'; readonly from: string; readonly id: string }
  | { readonly kind: 'spoil'; readonly from: string; readonly id: string }
  | { readonly kind: 'watch'; readonly from: string };

/** Somewhere to put a message. The transport's whole surface; see `channel.ts`. */
export interface NetChannel {
  send(message: NetMessage): void;
}

/**
 * The machine that owns the world.
 *
 * It plays its own run exactly as a solo player does — `stepWorld` is called the
 * same way from the same loop — and does two extra things: it folds in whatever
 * the guests said they were doing, and it publishes the result on a clock of its
 * own.
 */
export class HostSession {
  readonly guest = false;

  /** Which player each lobby member drives, by the id the lobby gave them. */
  private readonly seats: ReadonlyMap<string, number>;

  /**
   * The last thing each guest said their hands were doing.
   *
   * Held rather than applied once, because a held key is not an event. The
   * input layer writes intent every tick locally, and the steering system is
   * built on that: it turns a standing walk order into this tick's intent, then
   * reads intent next tick to decide whether a hand has taken the wheel back.
   * A remote intent written once and left alone answers "yes" to that on the
   * very next tick and cancels the order it just issued — which is what the
   * first version of this did, and what `tests/session.test.ts` caught.
   */
  private readonly held = new Map<number, { x: number; y: number }>();
  private due = 0;

  constructor(
    private readonly channel: NetChannel,
    members: readonly string[],
  ) {
    this.seats = new Map(members.map((member, seat) => [member, seat]));
  }

  /**
   * Writes every guest's hand onto their player, once per tick.
   *
   * Call it immediately before `stepWorld`, where the local input layer writes
   * the host's own. Seat zero is skipped: the lobby seats the host first, and
   * their hands are on this machine's keyboard.
   */
  applyInputs(world: World): void {
    for (const [seat, hand] of this.held) {
      if (seat === HOST_SEAT) continue;

      const player = world.players[seat];
      if (player === undefined) continue;

      player.intentX = hand.x;
      player.intentY = hand.y;
    }
  }

  /**
   * Applies one thing a guest did.
   *
   * Every branch starts by turning `from` into a seat, and a message from
   * somebody with no seat is dropped. That is the whole of the trust model and
   * it is enough for what this is: a guest can drive their own player and
   * nothing else, so the worst a bad message can do is make its sender walk
   * into a wall.
   */
  receive(world: World, message: NetMessage): void {
    if (message.kind === 'snapshot') return;

    const seat = this.seats.get(message.from);
    if (seat === undefined) return;

    const player = world.players[seat];
    if (player === undefined) return;

    switch (message.kind) {
      case 'input':
        // Stored, not applied: `applyInputs` puts it on the player every tick.
        // The order is different — a click is an event, and it happens once.
        this.held.set(seat, { x: message.x, y: message.y });
        // Set but never cleared from here. `steeringSystem` drops a standing
        // order the moment a hand takes the wheel back, and it reads the intent
        // this line just stored — so a guest walking away from their own click
        // cancels it exactly the way a local player does, without a message
        // for it.
        if (message.target !== null) player.moveTarget = { ...message.target };
        break;
      case 'pick':
        // Guarded by whose menu is actually up, not by who asked. A guest
        // holding a digit while somebody else's cards are on screen must not
        // spend their level.
        if (world.choosing === seat) applyUpgrade(world, player, message.id);
        break;
      case 'spoil':
        if (world.choosing === seat) takeSpoil(world, player, message.id);
        break;
      case 'watch':
        if (player.hp <= 0) player.watching = nextLiving(world, player.watching);
        break;
      default: {
        // Exhaustiveness check: a message added without a branch here stops
        // compiling rather than being quietly ignored on the wire.
        const unhandled: never = message;
        throw new Error(`Unhandled net message: ${String(unhandled)}`);
      }
    }
  }

  /**
   * Sends the world, at most `SNAPSHOT_HZ` times a second.
   *
   * Called every tick and mostly does nothing, which is cheaper than a second
   * timer and keeps the rate tied to simulation time rather than to wall clock:
   * a host whose tab was throttled sends fewer snapshots rather than a burst of
   * identical ones on the way back.
   */
  publish(world: World, dt: number): void {
    this.due -= dt;
    if (this.due > 0) return;

    this.due += 1 / SNAPSHOT_HZ;
    this.channel.send({ kind: 'snapshot', bytes: encodeSnapshot(world) });
  }
}

/**
 * A machine that only watches.
 *
 * It never steps the world. What it holds is a mailbox with the shape of one —
 * see `applySnapshot` — and its whole job is to keep saying what its hands are
 * doing and to pour in whatever arrives.
 */
export class GuestSession {
  readonly guest = true;

  /** What was last sent, so an unchanged hand is not re-sent sixty times. */
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly channel: NetChannel,
    private readonly self: string,
    /** Which player in the world is this machine's. */
    readonly seat: number,
  ) {}

  receive(world: World, message: NetMessage): void {
    if (message.kind !== 'snapshot') return;
    applySnapshot(world, message.bytes);
  }

  /**
   * Says where this player is trying to go.
   *
   * Only when it changed. A hand resting on a key is the common case and it is
   * already known on the other end, so an idle player costs nothing at all —
   * which matters more than it sounds, because four guests each sending sixty
   * messages a second is four hundred round trips a minute of nothing.
   */
  sendInput(x: number, y: number, target: { x: number; y: number } | null): void {
    if (x === this.lastX && y === this.lastY && target === null) return;

    this.lastX = x;
    this.lastY = y;
    this.channel.send({
      kind: 'input',
      from: this.self,
      x,
      y,
      target: target === null ? null : { x: target.x, y: target.y },
    });
  }

  pick(id: string): void {
    this.channel.send({ kind: 'pick', from: this.self, id });
  }

  takeSpoil(id: string): void {
    this.channel.send({ kind: 'spoil', from: this.self, id });
  }

  watchNext(): void {
    this.channel.send({ kind: 'watch', from: this.self });
  }
}

export type Session = HostSession | GuestSession;
