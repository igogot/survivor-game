import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionCanCarryAPassword } from '../src/net/accounts';

/**
 * What this browser claims to be, and when a password may leave it.
 *
 * The identity store is a few lines over `localStorage`, which does not exist
 * in this environment — so it is given one. What is worth testing is not that
 * a string round-trips but the two rules with teeth: a token is only ever sent
 * for the name it belongs to, and a password never leaves an unencrypted page.
 */

class FakeStorage {
  private readonly entries = new Map<string, string>();
  /** Set to have every access throw, the way a blocked-storage browser does. */
  hostile = false;

  getItem(key: string): string | null {
    if (this.hostile) throw new Error('denied');
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.hostile) throw new Error('denied');
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    if (this.hostile) throw new Error('denied');
    this.entries.delete(key);
  }
}

let storage: FakeStorage;

beforeEach(async () => {
  storage = new FakeStorage();
  vi.stubGlobal('window', { localStorage: storage });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Imported per test, because the module reads `window` when it is called. */
async function identity() {
  return import('../src/net/identity');
}

describe('what the browser holds', () => {
  it('remembers a name and its proof together', async () => {
    const { saveIdentity, loadIdentity } = await identity();
    saveIdentity('Kira', 'a'.repeat(64));

    expect(loadIdentity()).toEqual({ name: 'Kira', token: 'a'.repeat(64), kept: false });
  });

  it('starts out holding nothing', async () => {
    const { loadIdentity } = await identity();
    expect(loadIdentity()).toEqual({ name: '', token: '', kept: false });
  });

  /**
   * The panel says different things to somebody holding a name here only and
   * somebody signed in, and offers a password to the first but not the second.
   * Guessing that would have it offer to protect a name that already has one.
   */
  it('remembers whether a password stands behind the name', async () => {
    const { saveIdentity, loadIdentity } = await identity();

    saveIdentity('Kira', 'e'.repeat(64));
    expect(loadIdentity().kept).toBe(false);

    saveIdentity('Kira', 'e'.repeat(64), true);
    expect(loadIdentity().kept).toBe(true);
  });

  it('forgets that too on the way out', async () => {
    const { saveIdentity, forgetToken, loadIdentity } = await identity();
    saveIdentity('Kira', 'f'.repeat(64), true);
    forgetToken();

    expect(loadIdentity()).toEqual({ name: 'Kira', token: '', kept: false });
  });

  /**
   * The rule that stops a secret being sent somewhere it means nothing. A
   * player who types a different name has no proof of that one, and the token
   * would be travelling for no reason at all.
   */
  it('offers the token only for the name it belongs to', async () => {
    const { saveIdentity, tokenFor } = await identity();
    saveIdentity('Kira', 'b'.repeat(64));

    expect(tokenFor('Kira')).toBe('b'.repeat(64));
    expect(tokenFor('KIRA')).toBe('b'.repeat(64));
    expect(tokenFor('Volk')).toBe('');
  });

  it('forgets the proof but keeps the name in the box', async () => {
    const { saveIdentity, forgetToken, loadIdentity } = await identity();
    saveIdentity('Kira', 'c'.repeat(64));
    forgetToken();

    expect(loadIdentity()).toEqual({ name: 'Kira', token: '', kept: false });
  });

  /** Anything that is not hex of the right length did not come from the server. */
  it('refuses a token that cannot be one', async () => {
    const { loadIdentity } = await identity();
    storage.setItem('survivor.token', 'not-a-token');
    expect(loadIdentity().token).toBe('');

    storage.setItem('survivor.token', 'ab');
    expect(loadIdentity().token).toBe('');
  });

  it('cleans a name that was tampered with in storage', async () => {
    const { loadIdentity } = await identity();
    storage.setItem('survivor.name', `bad${String.fromCodePoint(0x202e)}name`);
    expect(loadIdentity().name).toBe('badname');
  });

  /**
   * Private windows and blocked site data throw on every access. A leaderboard
   * is not worth taking the result screen down for.
   */
  it('survives a browser that refuses to store anything', async () => {
    const { saveIdentity, loadIdentity, forgetToken } = await identity();
    storage.hostile = true;

    expect(() => saveIdentity('Kira', 'd'.repeat(64))).not.toThrow();
    expect(() => forgetToken()).not.toThrow();
    expect(loadIdentity()).toEqual({ name: '', token: '', kept: false });
  });
});

describe('when a password may leave the page', () => {
  const at = (protocol: string, hostname: string): Location =>
    ({ protocol, hostname }) as Location;

  it('allows https', () => {
    expect(connectionCanCarryAPassword(at('https:', 'example.ru'))).toBe(true);
  });

  /**
   * A score in the clear costs nothing. A password in the clear is a password,
   * and people reuse them — so this is the one place the client is stricter
   * than the server.
   */
  it('refuses plain http', () => {
    expect(connectionCanCarryAPassword(at('http:', 'example.ru'))).toBe(false);
  });

  it('allows localhost, which never leaves the machine', () => {
    expect(connectionCanCarryAPassword(at('http:', 'localhost'))).toBe(true);
    expect(connectionCanCarryAPassword(at('http:', '127.0.0.1'))).toBe(true);
  });
});
