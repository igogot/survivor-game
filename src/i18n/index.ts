import { EN } from './en';
import { RU } from './ru';
import { RU_ROLES, RU_SPOILS, RU_UPGRADES, RU_WEAPONS, EN_ROLES } from './content';
import { getLang, pluralRu } from './lang';
import type { StringId } from './en';
import type { ContentText } from './content';

/**
 * Reading text out of the tables.
 *
 * Every call reads the current language rather than being handed one, which is
 * what lets a label deep in the interface be translated without threading a
 * language through six constructors. The cost is process-wide state, and
 * `resetLang` in `lang.ts` is what pays it back for the tests.
 */

const TABLES = { en: EN, ru: RU } as const;

/** What fills a `{hole}` in a template: a number, a clock, a word. */
export type Params = Readonly<Record<string, string | number>>;

export function t(id: StringId, params?: Params): string {
  return fill(TABLES[getLang()][id], params);
}

/**
 * The right form of a counted noun.
 *
 * English has two and Russian three, and the rule for which is which is the
 * language's business rather than the caller's — a screen asking for "the word
 * for this many bosses" should not have to know that 11 behaves like 5.
 */
export function plural(
  count: number,
  forms: { readonly one: StringId; readonly few: StringId; readonly many: StringId },
): string {
  if (getLang() === 'ru') {
    return t(pluralRu(count, forms.one, forms.few, forms.many));
  }
  return t(count === 1 ? forms.one : forms.many);
}

/**
 * The same lookup, as DOM nodes, for lines with keycaps in them.
 *
 * `Pick one — press 1 2 3 4 or click` is one sentence with a run of `<kbd>` in
 * the middle, and in Russian the run lands somewhere else in it. Splitting the
 * translated string on its own holes puts the caps where that language wants
 * them, and it does it without `innerHTML` — the rule the help panel already
 * keeps, for the same reason: this text ends up carrying weapon names and tuned
 * numbers, and an angle bracket in one of those must never become markup.
 */
export function textNodes(id: StringId, slots: Readonly<Record<string, readonly Node[]>>): Node[] {
  const template = TABLES[getLang()][id];
  const out: Node[] = [];
  let rest = template;

  while (rest.length > 0) {
    const open = rest.indexOf('{');
    const close = open === -1 ? -1 : rest.indexOf('}', open);
    if (open === -1 || close === -1) break;

    const name = rest.slice(open + 1, close);
    const filling = slots[name];
    if (filling === undefined) {
      // Not a slot this caller knows about — leave it alone rather than
      // swallowing it, so a mismatched template shows up instead of vanishing.
      out.push(document.createTextNode(rest.slice(0, close + 1)));
      rest = rest.slice(close + 1);
      continue;
    }

    if (open > 0) out.push(document.createTextNode(rest.slice(0, open)));
    out.push(...filling);
    rest = rest.slice(close + 1);
  }

  if (rest.length > 0) out.push(document.createTextNode(rest));
  return out;
}

/**
 * Stamps every element carrying `data-i18n` with its line.
 *
 * The markup keeps the ids and the tables keep the words, so `index.html` stays
 * a page rather than a dictionary, and switching language is one pass over the
 * document instead of a rebuild of the interface.
 */
export function applyStaticText(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const id = node.dataset.i18n;
    if (id !== undefined && isStringId(id)) node.textContent = t(id);
  }

  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const id = node.dataset.i18nLabel;
    if (id !== undefined && isStringId(id)) node.setAttribute('aria-label', t(id));
  }

  // The third kind, for the one field a player types into. Same reason as the
  // other two: the markup keeps the id and the tables keep the words.
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const id = node.dataset.i18nPlaceholder;
    if (id !== undefined && isStringId(id)) node.setAttribute('placeholder', t(id));
  }
}

function isStringId(value: string): value is StringId {
  return Object.prototype.hasOwnProperty.call(EN, value);
}

/*
 * Content lookups. Each takes the definition the simulation already has, so the
 * English is read straight off it and only the other language needs a table.
 */

export function weaponName(def: { readonly id: string; readonly name: string }): string {
  return getLang() === 'ru' ? (RU_WEAPONS[def.id] ?? def.name) : def.name;
}

/**
 * What a weapon is for, in one line.
 *
 * The same sentence the rules panel prints and the weapon picker shows: a
 * choice described one way where it is made and another way in the rules is how
 * a player learns to distrust both.
 */
export function weaponRole(id: string): string {
  const table = getLang() === 'ru' ? RU_ROLES : EN_ROLES;
  return table[id] ?? EN_ROLES[id] ?? '';
}

export function upgradeName(def: { readonly id: string; readonly name: string }): string {
  return content(RU_UPGRADES, def.id)?.name ?? def.name;
}

export function upgradeDescription(def: {
  readonly id: string;
  readonly description: string;
}): string {
  return content(RU_UPGRADES, def.id)?.description ?? def.description;
}

export function spoilName(def: { readonly id: string; readonly name: string }): string {
  return content(RU_SPOILS, def.id)?.name ?? def.name;
}

export function spoilDescription(def: {
  readonly id: string;
  readonly description: string;
}): string {
  return content(RU_SPOILS, def.id)?.description ?? def.description;
}

/** Russian for one id, or nothing — in English there is nothing to look up. */
function content(
  table: Readonly<Record<string, ContentText>>,
  id: string,
): ContentText | undefined {
  return getLang() === 'ru' ? table[id] : undefined;
}

function fill(template: string, params?: Params): string {
  if (params === undefined) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
