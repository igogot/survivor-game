/**
 * Team codes: the thing one player reads out and another types in.
 *
 * That sentence is the whole specification, and it is what the alphabet below
 * is chosen for rather than for entropy. A code is passed by voice, by chat, by
 * a photo of a screen — so no character in it may be confusable with another
 * one. `0`/`O`, `1`/`I`/`l` and `5`/`S` are the pairs that cost people their
 * evening, and the cheapest fix is to make half of each pair impossible.
 *
 * What is left is thirty-one symbols over six places: about nine hundred
 * million codes. Nobody is guessing their way into a waiting room, which is the
 * other half of what the code is for — it is a shared secret, and the only way
 * to hold one is to have been told it.
 */

/** Digits and letters with no lookalike: no 0/O, no 1/I/L, no 5/S. */
export const CODE_ALPHABET = '2346789ABCDEFGHJKMNPQRTUVWXYZ';

export const CODE_LENGTH = 6;

/**
 * A fresh code, drawn from whatever randomness the caller has.
 *
 * The source is passed in rather than reached for, because the two callers want
 * different things: the game wants `crypto`, and a test wants to know what it is
 * going to get. `random` returns a number in [0, 1) — the same shape
 * `Math.random` has, so anything can supply one.
 */
export function makeCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * What somebody typed, as a code.
 *
 * Forgiving about everything that is not information: case, spaces, and the
 * dashes people insert to make six characters readable. Not forgiving about
 * unknown characters — a `0` in a code from an alphabet with no `0` in it means
 * the code was misread, and silently dropping it would turn a wrong code into a
 * differently wrong code five characters long.
 */
export function normaliseCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]+/g, '');
}

export function isCode(value: string): boolean {
  if (value.length !== CODE_LENGTH) return false;
  for (const symbol of value) {
    if (!CODE_ALPHABET.includes(symbol)) return false;
  }
  return true;
}

/**
 * An identity for one person in a lobby.
 *
 * Long enough that two people never collide, short enough to log. It is not a
 * code and is never shown: it is what lets the host tell one guest from another
 * over a channel everybody hears.
 */
export function makeMemberId(random: () => number): string {
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return id;
}

/**
 * The randomness the game itself uses.
 *
 * `crypto` where there is one, and `Math.random` where there is not. Codes are
 * a secret rather than a simulation, so unlike everything in `src/world` this
 * deliberately is *not* reproducible — a run's seed must not be enough to guess
 * the room it was played in.
 */
export function secureRandom(): number {
  const web = globalThis.crypto;
  if (web?.getRandomValues !== undefined) {
    const buffer = new Uint32Array(1);
    web.getRandomValues(buffer);
    return buffer[0] / 2 ** 32;
  }
  return Math.random();
}
