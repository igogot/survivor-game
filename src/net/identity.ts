import { cleanName, nameKey } from '../core/scores';

/**
 * Who this browser says it is.
 *
 * Two strings and no more: the name a player chose, and the token that proves
 * the name is theirs. The token is minted by the server the first time a name
 * is used and is never chosen, typed or shown — a player who never wants an
 * account never learns it exists, and their name still cannot be taken.
 *
 * A password is deliberately absent. Signing in exchanges one for a token and
 * the password is then forgotten, so it lives in this process for the length of
 * one request and is never written down. Storage is readable by anything that
 * can run script on the page; a token there costs the name, a password there
 * would cost whatever else it was reused for.
 *
 * Every read and write is wrapped, because storage throws rather than returning
 * null in a private window and wherever site data is blocked. A leaderboard is
 * not worth taking the result screen down for.
 */

const NAME_KEY = 'survivor.name';
const TOKEN_KEY = 'survivor.token';
const PROTECTED_KEY = 'survivor.protected';

export interface Identity {
  /** Empty when nobody has chosen a name on this browser yet. */
  readonly name: string;
  /** Empty when the name is held by nobody, or held somewhere else. */
  readonly token: string;
  /**
   * Whether a password stands behind the name.
   *
   * Told to us by the server rather than guessed, because the panel says
   * different things in the two cases — "you hold this here only" against
   * "signed in" — and guessing would have it offer to set a password on a name
   * that already has one.
   */
  readonly kept: boolean;
}

/**
 * Who to tell when the name changes.
 *
 * The HUD shows the name a run will be submitted under, and it has to be right
 * the moment somebody signs in or out rather than after a reload. Reading
 * storage every frame would answer the same question sixty times a second, so
 * the two functions that can change the answer say so instead — the same shape
 * `onLangChange` uses, and for the same reason.
 */
const listeners = new Set<(identity: Identity) => void>();

/** Subscribes to sign-in and sign-out. Returns the unsubscribe. */
export function onIdentityChange(listener: (identity: Identity) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  const identity = loadIdentity();
  for (const listener of listeners) listener(identity);
}

export function loadIdentity(): Identity {
  return {
    name: read(NAME_KEY, cleanName),
    token: read(TOKEN_KEY, asToken),
    kept: read(PROTECTED_KEY, (raw) => (raw === '1' ? '1' : null)) === '1',
  };
}

/**
 * Remembers a name and the proof that goes with it.
 *
 * Written together on purpose. A name kept without its token is a name the
 * player is about to be refused, and a token kept without its name proves
 * nothing at all — the two are one fact.
 */
export function saveIdentity(name: string, token: string, kept = false): void {
  write(NAME_KEY, name);
  write(TOKEN_KEY, token);
  write(PROTECTED_KEY, kept ? '1' : '');
  announce();
}

/**
 * Forgets the proof but keeps the name in the box.
 *
 * What signing out means here. The name stays because it is what the player
 * types anyway, and the token goes because it is the part that is no longer
 * true of this browser.
 */
export function forgetToken(): void {
  write(TOKEN_KEY, '');
  write(PROTECTED_KEY, '');
  announce();
}

/**
 * The token, but only if it belongs to the name being submitted.
 *
 * A player who types a different name than the one they hold has no proof of
 * that one, and sending the token anyway would be sending it somewhere it does
 * not apply — a request that can only be refused, carrying a secret with it.
 */
export function tokenFor(name: string): string {
  const held = loadIdentity();
  return nameKey(held.name) === nameKey(name) ? held.token : '';
}

/** Tokens are hex from the server; anything else did not come from there. */
function asToken(raw: string): string | null {
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

function read(key: string, clean: (raw: string) => string | null): string {
  try {
    return clean(window.localStorage.getItem(key) ?? '') ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value === '') window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // A name that cannot be remembered is a name typed again next time.
  }
}
