import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import markup from '../index.html?raw';
import { SPOILS } from '../src/data/spoils';
import { UPGRADES } from '../src/data/upgrades';
import { WEAPONS } from '../src/data/weapons';
import { EN } from '../src/i18n/en';
import { RU } from '../src/i18n/ru';
import { EN_ROLES, RU_ROLES, RU_SPOILS, RU_UPGRADES, RU_WEAPONS } from '../src/i18n/content';
import {
  DEFAULT_LANG,
  LANGS,
  getLang,
  initLang,
  pluralRu,
  resetLang,
  setLang,
} from '../src/i18n/lang';
import { t, textNodes, upgradeDescription, upgradeName, weaponName, weaponRole } from '../src/i18n';
import { describeOffer, describeSpoil } from '../src/ui/offers';
import { helpSections } from '../src/ui/help';
import { resultSubtitle } from '../src/ui/menus';
import type { StringId } from '../src/i18n/en';

/**
 * A second language fails quietly by nature: a missing line renders as a blank
 * card, and an English sentence inside a Russian panel looks like a choice
 * somebody made. `ru.ts` is typed against `StringId`, so the compiler already
 * refuses a missing key — these tests cover what a type cannot see. That a
 * translated line still carries the holes its numbers go into, that every card
 * and weapon in the game has a Russian name, and that nothing here is a
 * translation of something that no longer exists.
 */

// Language is process-wide, which is what lets any label read it without being
// handed one. That also makes it leak between tests unless it is put back.
afterEach(() => resetLang());

const ids = Object.keys(EN) as StringId[];

/** The `{holes}` in a template, in the order they appear. */
function holes(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe('the string tables', () => {
  it('opens in English whatever the browser is', () => {
    expect(DEFAULT_LANG).toBe('en');
    expect(getLang()).toBe('en');
    expect(initLang('')).toBe('en');
  });

  it('opens in the language the link asks for', () => {
    expect(initLang('?lang=ru')).toBe('ru');
    expect(getLang()).toBe('ru');
  });

  it('ignores a language it does not have', () => {
    expect(initLang('?lang=fr')).toBe('en');
  });

  it('translates every line into something', () => {
    for (const id of ids) {
      expect(EN[id], id).not.toBe('');
      expect(RU[id], id).not.toBe('');
    }
  });

  /**
   * The failure this catches is the quiet one: a sentence translated without
   * its `{count}`, which then renders as a sentence with the number missing
   * rather than as an error.
   */
  it('keeps every hole a number goes into', () => {
    for (const id of ids) {
      const english = holes(EN[id]);
      const russian = holes(RU[id]);

      // Russian may add one — `result.sub.many` needs the noun as well as the
      // count, because five bosses take a different word to two. It may never
      // drop one.
      for (const hole of english) {
        expect(russian, `${id} lost {${hole}}`).toContain(hole);
      }
    }
  });

  it('says something different in each language', () => {
    // Not every line has to differ — `start.title` is the game's own name — but
    // a table that matched everywhere would mean nothing was translated at all.
    const same = ids.filter((id) => EN[id] === RU[id]);
    expect(same.length).toBeLessThan(ids.length / 10);
  });
});

describe('content keyed by game data', () => {
  it('names every weapon in Russian, and describes it', () => {
    for (const weapon of WEAPONS) {
      expect(RU_WEAPONS[weapon.id], weapon.id).toBeDefined();
      expect(RU_ROLES[weapon.id], weapon.id).toBeDefined();
      expect(EN_ROLES[weapon.id], weapon.id).toBeDefined();
    }
  });

  it('names every level-up card in Russian, and describes it', () => {
    for (const upgrade of UPGRADES) {
      const text = RU_UPGRADES[upgrade.id];
      expect(text, upgrade.id).toBeDefined();
      expect(text?.name, upgrade.id).not.toBe('');
      expect(text?.description, upgrade.id).not.toBe('');
    }
  });

  it('names every spoil in Russian, and describes it', () => {
    for (const spoil of SPOILS) {
      expect(RU_SPOILS[spoil.id], spoil.id).toBeDefined();
    }
  });

  /**
   * The other direction, which nothing else would catch: a card deleted from
   * the pool leaves its translation behind, and the next person to read the
   * file believes the card still exists.
   */
  it('keeps no translation for something that was deleted', () => {
    const upgradeIds = new Set(UPGRADES.map((upgrade) => upgrade.id));
    for (const id of Object.keys(RU_UPGRADES)) {
      expect(upgradeIds.has(id), `${id} is translated but not offered`).toBe(true);
    }

    const weaponIds = new Set(WEAPONS.map((weapon) => weapon.id));
    for (const id of Object.keys(RU_WEAPONS)) {
      expect(weaponIds.has(id), `${id} is translated but is not a weapon`).toBe(true);
    }
    for (const id of Object.keys(RU_ROLES)) {
      expect(weaponIds.has(id), `${id} has a role but is not a weapon`).toBe(true);
    }

    const spoilIds = new Set<string>(SPOILS.map((spoil) => spoil.id));
    for (const id of Object.keys(RU_SPOILS)) {
      expect(spoilIds.has(id), `${id} is translated but is not a spoil`).toBe(true);
    }
  });
});

describe('what the screens say', () => {
  it('reads English off the definitions and Russian out of the table', () => {
    const bolt = WEAPONS[0];
    expect(weaponName(bolt)).toBe(bolt.name);

    setLang('ru');
    expect(weaponName(bolt)).toBe(RU_WEAPONS[bolt.id]);
    expect(weaponRole(bolt.id)).toBe(RU_ROLES[bolt.id]);
  });

  it('translates the level-up cards', () => {
    const card = UPGRADES[0];
    expect(upgradeName(card)).toBe(card.name);

    setLang('ru');
    expect(upgradeName(card)).toBe(RU_UPGRADES[card.id]?.name);
    expect(upgradeDescription(card)).toBe(RU_UPGRADES[card.id]?.description);
  });

  it('translates the card badges and the stack line', () => {
    const card = UPGRADES.find((upgrade) => upgrade.kind === 'stat');
    expect(card).toBeDefined();
    if (card === undefined) return;

    expect(describeOffer(card, 0).badge).toBe('UPGRADE');
    expect(describeOffer(card, 0).progress).toBe('NEW');

    setLang('ru');
    expect(describeOffer(card, 0).badge).toBe(t('badge.upgrade'));
    expect(describeOffer(card, 0).progress).toBe(t('offer.new'));
    expect(describeOffer(card, 1).progress).toContain(t('offer.level'));
  });

  it('translates the chest cards', () => {
    expect(describeSpoil(SPOILS[0]).note).toBe('ONE USE');

    setLang('ru');
    expect(describeSpoil(SPOILS[0]).note).toBe(t('spoil.oneUse'));
  });

  it('translates the whole rules panel, weapon lines included', () => {
    setLang('ru');
    const sections = helpSections();

    expect(sections.map((section) => section.title)).toContain(t('help.section.weapons'));

    for (const section of sections) {
      for (const row of section.rows) {
        expect(row.detail, section.title).not.toBe('');
        // A Latin-only line here would be one the translation missed. Keycaps
        // are Latin on purpose, so only the prose is checked.
        expect(row.detail).toMatch(/[А-Яа-яЁё]/);
      }
    }
  });

  it("still quotes the simulation's own numbers in Russian", () => {
    setLang('ru');
    const details = helpSections()
      .flatMap((section) => section.rows)
      .map((row) => row.detail)
      .join('\n');

    // The boss cadence, which the English panel is already pinned to.
    expect(details).toContain('10:00');
  });
});

/**
 * The markup carries ids and the tables carry words, which means the two can
 * drift apart in a way neither the compiler nor a rendering test would notice:
 * a `data-i18n` naming a line that does not exist simply leaves the English
 * default on the page, looking exactly like a line nobody got round to.
 *
 * Read as text, the way `tests/menus.test.ts` reads it, so this still needs no
 * DOM.
 */
describe('the markup and the tables', () => {
  // Every stamp kind, placeholders included. A typo in one of those renders
  // as an empty box rather than an error, which is the sort of thing that
  // ships.
  const stamped = [...markup.matchAll(/data-i18n(?:-label|-placeholder)?="([^"]+)"/g)].map(
    (match) => match[1],
  );

  it('finds ids to check in the first place', () => {
    expect(stamped.length).toBeGreaterThan(10);
  });

  it('names only lines that exist', () => {
    for (const id of stamped) {
      expect(Object.hasOwn(EN, id), `index.html asks for a line called "${id}"`).toBe(true);
    }
  });

  /**
   * The three lines with keycaps inside them are filled by `renderKeyLines`
   * rather than stamped, so what they need is an empty element to fill. A typo
   * in one of these ids renders as a missing sentence rather than as an error.
   */
  it('leaves an element for every line built out of keycaps', () => {
    for (const id of ['levelup-sub', 'pause-sub', 'result-hint']) {
      expect(markup, `index.html is missing id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it('puts a switch on the page for every language there is', () => {
    for (const lang of LANGS) {
      expect(markup, `no switch for ${lang}`).toContain(`data-lang="${lang}"`);
    }
  });
});

/**
 * The one piece of translation machinery with a way to go wrong quietly.
 *
 * `Esc or P to resume · R to restart` is one sentence with three keycaps inside
 * it, and Russian puts them in a different shape around different words. A
 * translation that drops a hole loses a keycap, and the line still renders —
 * just without the key it was telling you to press.
 *
 * Tested against a stand-in for the two DOM calls `textNodes` makes, so a Node
 * suite still needs no DOM.
 */
describe('lines with keycaps in them', () => {
  interface FakeNode {
    readonly text?: string;
    readonly cap?: string;
  }

  const asNodes = (nodes: readonly FakeNode[]): readonly Node[] =>
    nodes as unknown as readonly Node[];

  const readBack = (nodes: readonly Node[]): string =>
    (nodes as unknown as FakeNode[])
      .map((node) => (node.cap === undefined ? (node.text ?? '') : `[${node.cap}]`))
      .join('');

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {
      createTextNode: (text: string): FakeNode => ({ text }),
    };
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  const caps = {
    esc: asNodes([{ cap: 'Esc' }]),
    p: asNodes([{ cap: 'P' }]),
    r: asNodes([{ cap: 'R' }]),
  };

  it('puts every keycap where that language wants it', () => {
    expect(readBack(textNodes('pause.sub', caps))).toBe(
      '[Esc] or [P] to resume · [R] to restart',
    );

    setLang('ru');
    expect(readBack(textNodes('pause.sub', caps))).toBe(
      '[Esc] или [P] — продолжить · [R] — начать заново',
    );
  });

  it('loses no keycap in translation', () => {
    for (const lang of LANGS) {
      setLang(lang);
      const line = readBack(textNodes('pause.sub', caps));
      for (const cap of ['Esc', 'P', 'R']) {
        expect(line, `${lang} lost ${cap}`).toContain(`[${cap}]`);
      }
    }
  });
});

describe('counting in Russian', () => {
  /**
   * Three forms rather than two, and 11 through 14 take the last one even
   * though they end in 1 through 4 — the part a naive rule gets wrong.
   */
  it('picks the form the number actually takes', () => {
    const forms = (n: number): string => pluralRu(n, 'босс', 'босса', 'боссов');

    expect(forms(1)).toBe('босс');
    expect(forms(2)).toBe('босса');
    expect(forms(4)).toBe('босса');
    expect(forms(5)).toBe('боссов');
    expect(forms(11)).toBe('боссов');
    expect(forms(12)).toBe('боссов');
    expect(forms(21)).toBe('босс');
    expect(forms(22)).toBe('босса');
    expect(forms(25)).toBe('боссов');
  });

  it('agrees with the number on the result screen', () => {
    setLang('ru');

    expect(resultSubtitle(0)).toBe(t('result.sub.none'));
    expect(resultSubtitle(1)).toBe(t('result.sub.one'));
    expect(resultSubtitle(2)).toContain('2 босса');
    expect(resultSubtitle(5)).toContain('5 боссов');
    expect(resultSubtitle(11)).toContain('11 боссов');
    expect(resultSubtitle(21)).toContain('21 босс');
  });
});
