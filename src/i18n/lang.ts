/**
 * Which language the page is in, and how that choice is remembered.
 *
 * English is the default and always the default: the game opens in it whatever
 * the browser's own language is. A player who wants Russian asks for it once —
 * with the switch on the opening screen, or with `?lang=ru` in the link — and
 * the choice is remembered from then on.
 *
 * Deliberately not `navigator.language`. Guessing from the browser means the
 * same link opens in two different languages for two people, which makes a
 * shared link a coin toss and a bug report unreadable.
 */

export type Lang = 'en' | 'ru';

export const LANGS: readonly Lang[] = ['en', 'ru'];

/** English, and the fallback for anything unrecognised. */
export const DEFAULT_LANG: Lang = 'en';

const STORAGE_KEY = 'survivor.lang';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ru';
}

let current: Lang = DEFAULT_LANG;

const listeners = new Set<(lang: Lang) => void>();

/**
 * The language to open in: the link first, then what was chosen last time,
 * then English.
 *
 * The URL wins so that a Russian link is a Russian page even for someone whose
 * last visit was in English — a link that quietly ignores what it says is worse
 * than no link at all.
 *
 * Storage is read through a `try`: a browser with site data blocked throws on
 * access rather than returning null, and a language preference is not worth a
 * blank page.
 */
export function initLang(search: string): Lang {
  const asked = new URLSearchParams(search).get('lang');
  if (isLang(asked)) {
    current = asked;
    remember(asked);
    return current;
  }

  current = isLang(read()) ? (read() as Lang) : DEFAULT_LANG;
  return current;
}

export function getLang(): Lang {
  return current;
}

/** Sets the language, remembers it, and tells everyone who is drawing text. */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  remember(lang);
  for (const listener of listeners) listener(lang);
}

/** Subscribes to language changes. Returns the unsubscribe. */
export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resets the module between tests.
 *
 * Language is process-wide state, which is what lets every call site read it
 * without being handed it. That is also what makes one test able to leak into
 * the next, so the tests get a way to put it back.
 */
export function resetLang(lang: Lang = DEFAULT_LANG): void {
  current = lang;
  listeners.clear();
}

/**
 * The Russian plural, which is three forms rather than two.
 *
 * `1 босс`, `2 босса`, `5 боссов` — and 11 through 14 take the last form even
 * though they end in 1 through 4, which is the part a naive rule gets wrong.
 * English needs none of this, so it never calls in here.
 */
export function pluralRu<T>(count: number, one: T, few: T, many: T): T {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // A private window or blocked site data. The page still works; the choice
    // simply does not outlive it.
  }
}
