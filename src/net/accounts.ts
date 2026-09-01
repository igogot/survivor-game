import { saveIdentity } from './identity';

/**
 * Signing in, for the players who want their name to outlive a browser.
 *
 * Optional by design. The board works without any of this: a name is claimed
 * by the first run submitted under it and held by a token the browser keeps.
 * An account exists for one reason — that token dies with the storage it sits
 * in, and somebody who cares about their place wants a new laptop not to cost
 * them their name.
 *
 * The password only ever travels here, and only when the player is deliberately
 * signing in. What comes back is a token, and the token is what every later
 * submission uses. Nothing keeps the password afterwards.
 */

export type AccountAction = 'register' | 'login' | 'protect';

export type AccountResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: AccountFailure };

/**
 * Why it did not work.
 *
 * `wrongCredentials` covers both a bad password and a name nobody has an
 * account for, because the server deliberately cannot tell them apart in its
 * answer — otherwise this endpoint becomes a way to ask which names exist.
 */
export type AccountFailure =
  | 'offline'
  | 'insecure'
  | 'wrongCredentials'
  | 'nameTaken'
  | 'notYours'
  | 'alreadyProtected'
  | 'passwordShort'
  | 'tooMany'
  | 'name';

const ENDPOINT = import.meta.env.VITE_ACCOUNT_URL ?? 'api/account.php';
const TIMEOUT_MS = 8000;

/**
 * Refuses to send a password over a connection that is not encrypted.
 *
 * The one place this client is stricter than the server, and deliberately so.
 * A score sent in the clear is a score anybody on the wire can read, which
 * costs nothing; a password sent in the clear is a password, and people reuse
 * them. `localhost` is exempt because it never leaves the machine, which is
 * what makes developing this possible at all.
 */
export function connectionCanCarryAPassword(location: Location): boolean {
  if (location.protocol === 'https:') return true;
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

export class HttpAccounts {
  constructor(private readonly endpoint: string = ENDPOINT) {}

  async send(
    action: AccountAction,
    name: string,
    password: string,
    token = '',
  ): Promise<AccountResult> {
    if (!connectionCanCarryAPassword(window.location)) {
      return { ok: false, reason: 'insecure' };
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name, password, token }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const body = (await response.json().catch(() => ({}))) as {
        name?: unknown;
        token?: unknown;
        protected?: unknown;
        error?: unknown;
      };

      if (!response.ok) {
        return { ok: false, reason: reasonFor(body.error) };
      }
      if (typeof body.name !== 'string' || typeof body.token !== 'string') {
        return { ok: false, reason: 'offline' };
      }

      // The token replaces whatever this browser held. Signing in as somebody
      // else has to take the old name with it, or the next run is submitted as
      // a person the player is no longer.
      saveIdentity(body.name, body.token, body.protected === true);
      return { ok: true, name: body.name };
    } catch {
      return { ok: false, reason: 'offline' };
    }
  }
}

/** The server's words, mapped to this side's. Anything unknown is a network fault. */
function reasonFor(error: unknown): AccountFailure {
  switch (error) {
    case 'wrong-credentials':
      return 'wrongCredentials';
    case 'name-taken':
      return 'nameTaken';
    case 'not-yours':
      return 'notYours';
    case 'already-protected':
      return 'alreadyProtected';
    case 'password-short':
    case 'password-long':
    case 'password-shape':
      return 'passwordShort';
    case 'too-many-attempts':
      return 'tooMany';
    case 'name':
      return 'name';
    default:
      return 'offline';
  }
}
