import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { GuestSession, HostSession, SNAPSHOT_HZ } from '../src/net/session';
import { progressionSystem, xpForNextLevel } from '../src/systems/progression';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import type { NetMessage } from '../src/net/session';

/**
 * Two machines, one world.
 *
 * The host is a real run — the same `stepWorld` a solo player drives — and the
 * guest is a mailbox that never steps anything. What these check is that the
 * two stay the same picture, that a guest can only drive the player it owns,
 * and that nothing a guest says is taken as a fact about the world.
 *
 * The wire is an array. `BroadcastChannel` hands every message to everybody,
 * including the sender, so that is what this does too — the harder of the two
 * cases, and the one the real channel actually has.
 */

const DT = 1 / CONFIG.tickRate;

interface Wired {
  host: HostSession;
  guest: GuestSession;
  hostWorld: World;
  guestWorld: World;
  /** Runs the host for `seconds`, delivering everything both ways. */
  play: (seconds: number) => void;
  sent: NetMessage[];
}

function wire(seed: number, members: readonly string[], seat = 1): Wired {
  const sent: NetMessage[] = [];
  const hostWorld = new World(seed, members.map(() => 'bolt'));
  const guestWorld = new World(seed);

  const toHost: NetMessage[] = [];
  const toGuest: NetMessage[] = [];

  const host = new HostSession(
    {
      send: (message) => {
        sent.push(message);
        toGuest.push(message);
      },
    },
    members,
  );

  const guest = new GuestSession(
    {
      send: (message) => {
        sent.push(message);
        toHost.push(message);
      },
    },
    members[seat],
    seat,
  );

  return {
    host,
    guest,
    hostWorld,
    guestWorld,
    sent,
    play(seconds: number) {
      const ticks = Math.round(seconds * CONFIG.tickRate);
      for (let i = 0; i < ticks; i++) {
        while (toHost.length > 0) host.receive(hostWorld, toHost.shift() as NetMessage);
        // Where the local input layer writes the host's own hand.
        host.applyInputs(hostWorld);
        stepWorld(hostWorld, DT);
        host.publish(hostWorld, DT);
        while (toGuest.length > 0) guest.receive(guestWorld, toGuest.shift() as NetMessage);
      }
    },
  };
}

describe('what a guest sees', () => {
  it('is the host’s world, one snapshot behind', () => {
    const net = wire(42, ['a', 'b']);
    net.play(4);

    expect(net.guestWorld.players).toHaveLength(2);
    expect(net.guestWorld.enemies.length).toBe(net.hostWorld.enemies.length);
    expect(net.guestWorld.kills).toBe(net.hostWorld.kills);
    expect(net.guestWorld.time).toBeCloseTo(net.hostWorld.time, 1);
  });

  /** A guest steps nothing. Its clock only moves when a snapshot says so. */
  it('does not advance on its own', () => {
    const net = wire(43, ['a', 'b']);
    net.play(2);

    const stood = net.guestWorld.time;
    for (let i = 0; i < 200; i++) stepWorld(net.hostWorld, DT);

    expect(net.guestWorld.time).toBe(stood);
  });

  it('publishes at the rate it says it does, not once a tick', () => {
    const net = wire(44, ['a', 'b']);
    net.play(1);

    const snapshots = net.sent.filter((message) => message.kind === 'snapshot').length;
    expect(snapshots).toBeGreaterThanOrEqual(SNAPSHOT_HZ - 1);
    expect(snapshots).toBeLessThanOrEqual(SNAPSHOT_HZ + 1);
  });
});

describe('what a guest may do', () => {
  it('drives the player it owns', () => {
    const net = wire(45, ['a', 'b']);
    net.guest.sendInput(1, 0, null);
    net.play(1);

    expect(net.hostWorld.players[1].x).toBeGreaterThan(50);
    // And nobody else's.
    expect(net.hostWorld.players[0].x).toBe(0);
  });

  it('is ignored when it claims to be somebody else', () => {
    const net = wire(46, ['a', 'b']);
    net.host.receive(net.hostWorld, {
      kind: 'input',
      from: 'nobody-in-this-room',
      x: 1,
      y: 0,
      target: null,
    });

    for (let i = 0; i < 60; i++) stepWorld(net.hostWorld, DT);

    for (const player of net.hostWorld.players) expect(player.x).toBe(0);
  });

  it('says nothing while its hand is still', () => {
    const net = wire(47, ['a', 'b']);

    net.guest.sendInput(1, 0, null);
    net.guest.sendInput(1, 0, null);
    net.guest.sendInput(1, 0, null);

    expect(net.sent.filter((message) => message.kind === 'input')).toHaveLength(1);
  });

  /**
   * The order travels; taking it back does not have to. `steeringSystem` drops
   * a standing order the moment a hand takes the wheel back, and it reads the
   * intent the host stored — so walking away cancels the click without a
   * message for it, exactly as it does for a local player.
   */
  it('sends a walking order, and cancels it by walking', () => {
    const net = wire(48, ['a', 'b']);

    net.guest.sendInput(0, 0, { x: 400, y: 0 });
    net.play(0.1);
    expect(net.hostWorld.players[1].moveTarget).toEqual({ x: 400, y: 0 });

    net.guest.sendInput(-1, 0, null);
    net.play(0.1);
    expect(net.hostWorld.players[1].moveTarget).toBeNull();
  });
});

describe('menus across the wire', () => {
  /**
   * The cards a guest is asked to pick from are the host's roll. Rolling them
   * again on the client would be a second draw from a generator the client does
   * not have, so they travel — and this is the check that they arrive.
   */
  it('shows a guest the cards it has to choose from', () => {
    const net = wire(49, ['a', 'b']);
    net.hostWorld.xp = xpForNextLevel(net.hostWorld);
    progressionSystem(net.hostWorld);
    // Player 0 is owed a card first, so spend theirs to reach the guest's.
    const first = net.hostWorld.players[0];
    net.host.receive(net.hostWorld, {
      kind: 'pick',
      from: 'a',
      id: first.offered[0].id,
    });
    net.play(0.2);

    expect(net.hostWorld.choosing).toBe(1);
    expect(net.guestWorld.choosing).toBe(1);
    expect(net.guestWorld.players[1].offered.map((card) => card.id)).toEqual(
      net.hostWorld.players[1].offered.map((card) => card.id),
    );
  });

  /** A digit held down while somebody else is choosing must not spend a level. */
  it('refuses a pick from whoever is not at the menu', () => {
    const net = wire(50, ['a', 'b']);
    net.hostWorld.xp = xpForNextLevel(net.hostWorld);
    progressionSystem(net.hostWorld);
    expect(net.hostWorld.choosing).toBe(0);

    const card = net.hostWorld.players[0].offered[0].id;
    net.host.receive(net.hostWorld, { kind: 'pick', from: 'b', id: card });

    expect(net.hostWorld.players[1].stacks.size).toBe(0);
    expect(net.hostWorld.choosing).toBe(0);
  });
});

describe('a dead guest', () => {
  it('moves its camera and nothing else', () => {
    const net = wire(51, ['a', 'b', 'c']);
    const fallen = net.hostWorld.players[1];
    fallen.hp = 0;
    fallen.watching = 0;

    net.host.receive(net.hostWorld, { kind: 'watch', from: 'b' });
    expect(fallen.watching).toBe(2);

    net.host.receive(net.hostWorld, { kind: 'watch', from: 'b' });
    expect(fallen.watching).toBe(0);
  });

  it('cannot move its camera while it is alive', () => {
    const net = wire(52, ['a', 'b', 'c']);
    const standing = net.hostWorld.players[1];
    standing.watching = 0;

    net.host.receive(net.hostWorld, { kind: 'watch', from: 'b' });

    expect(standing.watching).toBe(0);
  });
});
