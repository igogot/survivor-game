import { describe, expect, it, vi } from 'vitest';
import { dedupe, nonce } from '../src/net/channel';
import { openMailbox } from '../src/net/mailbox';
import type { Envelope } from '../src/net/mailbox';
import type { LobbyMessage } from '../src/net/lobby';

/**
 * The half of the waiting room that leaves the machine.
 *
 * `fetch` is injected, so what these drive is the real polling loop against a
 * server that answers whatever the test wants — including nothing, which is the
 * case that matters most: a room that cannot be reached has to be a quiet room
 * rather than a broken game.
 */

const HELLO: LobbyMessage = { kind: 'hello', code: 'ABC234', from: 'GUEST' };

function wrapped(message: LobbyMessage): Envelope {
  return { n: nonce(), m: message };
}

/** A server that answers what it is told to, and remembers what it was asked. */
function server(pages: readonly { cursor: number; messages: readonly Envelope[] }[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let page = 0;

  return {
    calls,
    fetcher: async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });

      if ((init?.method ?? 'GET') !== 'GET') {
        return new Response('{"cursor":1}', { status: 200 });
      }

      const body = pages[Math.min(page++, pages.length - 1)] ?? { cursor: 0, messages: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  };
}

/** Lets the polling loop run for a moment without waiting a real second. */
async function settle(): Promise<void> {
  await vi.waitFor(() => Promise.resolve(), { timeout: 50 });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the post box', () => {
  it('says nothing at all until it is in a room', async () => {
    const net = server([]);
    const box = openMailbox(() => {}, net.fetcher, '/room');

    box.post(wrapped(HELLO));
    await settle();

    expect(net.calls).toHaveLength(0);
  });

  it('posts what it is given, under the name it joined as', async () => {
    const net = server([{ cursor: 0, messages: [] }]);
    const box = openMailbox(() => {}, net.fetcher, '/room');

    box.join('ABC234', 'ME');
    box.post(wrapped(HELLO));
    await settle();
    box.leave();

    const post = net.calls.find((call) => call.method === 'POST');
    expect(post?.url).toContain('code=ABC234');
    expect(post?.body).toMatchObject({ from: 'ME', message: { m: HELLO } });
  });

  it('hands on what the room had, and asks from where it left off', async () => {
    const heard: LobbyMessage[] = [];
    const net = server([{ cursor: 7, messages: [wrapped(HELLO)] }, { cursor: 7, messages: [] }]);
    const box = openMailbox((envelope) => heard.push(envelope.m), net.fetcher, '/room');

    box.join('ABC234', 'ME');
    await settle();
    box.leave();

    expect(heard).toEqual([HELLO]);
    expect(net.calls[0].url).toContain('since=0');
    expect(net.calls[0].url).toContain('me=ME');
  });

  /**
   * A room that cannot be reached is a quiet room. Everything it carries is
   * also on the local channel, so a lobby that threw here would take the game
   * down for a player who is not even using the network.
   */
  it('goes quiet rather than breaking when the server is gone', async () => {
    const heard: LobbyMessage[] = [];
    const box = openMailbox(
      (envelope) => heard.push(envelope.m),
      () => Promise.reject(new Error('offline')),
      '/room',
    );

    box.join('ABC234', 'ME');
    box.post(wrapped(HELLO));
    await settle();
    box.leave();

    expect(heard).toHaveLength(0);
  });

  it('stops asking once it has left', async () => {
    const net = server([{ cursor: 0, messages: [] }]);
    const box = openMailbox(() => {}, net.fetcher, '/room');

    box.join('ABC234', 'ME');
    await settle();
    box.leave();

    const asked = net.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(net.calls.length).toBe(asked);
  });
});

describe('hearing a message once', () => {
  /**
   * Every message goes out on both channels, so a second window on the same
   * machine hears each one twice — once as a broadcast, once as post.
   */
  it('drops the second delivery of the same message', () => {
    const heard: LobbyMessage[] = [];
    const deliver = dedupe((message) => heard.push(message));

    const envelope = wrapped(HELLO);
    deliver(envelope);
    deliver(envelope);

    expect(heard).toEqual([HELLO]);
  });

  /**
   * Twice is not the same as again. Somebody saying "ready" twice is two lines
   * of chat, and a guest knocking a second time is a guest who did not hear the
   * first answer — neither may be swallowed.
   */
  it('keeps a genuine repeat of the same words', () => {
    const heard: LobbyMessage[] = [];
    const deliver = dedupe((message) => heard.push(message));

    deliver(wrapped(HELLO));
    deliver(wrapped(HELLO));

    expect(heard).toHaveLength(2);
  });

  it('gives out an identity nothing else has', () => {
    const ids = new Set(Array.from({ length: 500 }, () => nonce()));
    expect(ids.size).toBe(500);
  });
});
