import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BOSS } from '../src/data/enemies';
import { WEAPONS } from '../src/data/weapons';
import { OFFERS_PER_LEVEL } from '../src/systems/progression';
import { helpSections } from '../src/ui/help';
import type { HelpRow } from '../src/ui/help';

/**
 * The help panel is the one place the game explains itself, so the failure mode
 * that matters is not a crash — it is a confident sentence that stopped being
 * true. These tests pin the panel to the constants and data it describes.
 *
 * Content lives apart from rendering precisely so this file needs no DOM.
 */

const SECTIONS = helpSections();
const ROWS: readonly HelpRow[] = SECTIONS.flatMap((section) => section.rows);

function detailsText(): string {
  return ROWS.map((row) => row.detail).join('\n');
}

describe('help content', () => {
  it('describes every weapon in the game', () => {
    const described = SECTIONS.flatMap((section) => section.rows)
      .filter((row) => row.kind === 'note')
      .map((row) => row.term);

    for (const weapon of WEAPONS) {
      expect(described).toContain(weapon.name);
    }
  });

  /**
   * A weapon added without a line here would render as a name over an empty
   * description — the one failure the panel cannot survive, because it looks
   * deliberate.
   */
  it('leaves no weapon without a description', () => {
    const weaponSection = SECTIONS.find((section) => section.title === 'The weapons');
    expect(weaponSection).toBeDefined();
    expect(weaponSection?.rows).toHaveLength(WEAPONS.length);

    for (const row of weaponSection?.rows ?? []) {
      expect(row.detail.length).toBeGreaterThan(20);
    }
  });

  it('offers exactly as many number keys as there are cards', () => {
    const numberRow = ROWS.find(
      (row) => row.kind === 'keys' && row.keys.length > 1 && row.keys[0] === '1',
    );

    expect(numberRow).toBeDefined();
    if (numberRow?.kind !== 'keys') throw new Error('expected a key row');

    expect(numberRow.keys).toEqual(
      Array.from({ length: OFFERS_PER_LEVEL }, (_, index) => String(index + 1)),
    );
  });

  it('quotes the run length the simulation actually uses', () => {
    const minutes = Math.floor(CONFIG.runDuration / 60);
    expect(detailsText()).toContain(`${minutes}:00`);
  });

  it("quotes the boss's real numbers", () => {
    const text = detailsText();
    expect(text).toContain(String(BOSS.hp));
    expect(text).toContain(String(BOSS.damage));
  });

  /**
   * Every key row is either keycaps or a gesture. One with neither renders as a
   * description hanging off a blank term.
   */
  it('gives every control something to press', () => {
    for (const row of ROWS) {
      if (row.kind !== 'keys') continue;
      const labelled = row.keys.length > 0 || row.gesture !== undefined;
      expect(labelled).toBe(true);
    }
  });

  /**
   * Keycaps are for a keyboard and gestures are for a thumb; a row that shows
   * both to everyone is the drift this split exists to prevent.
   */
  it('scopes keycap rows to the keyboard and gesture rows to touch', () => {
    for (const row of ROWS) {
      if (row.kind !== 'keys') continue;
      if (row.keys.length > 0) expect(row.audience).toBe('keys');
      if (row.gesture !== undefined) expect(row.audience).toBe('touch');
    }
  });

  it('covers both inputs for every action a player has to take', () => {
    const audiences = ROWS.filter((row) => row.kind === 'keys').map((row) => row.audience);
    expect(audiences).toContain('keys');
    expect(audiences).toContain('touch');
  });

  it('has no empty section and no empty line', () => {
    expect(SECTIONS.length).toBeGreaterThan(0);
    for (const section of SECTIONS) {
      expect(section.title).not.toBe('');
      expect(section.rows.length).toBeGreaterThan(0);
      for (const row of section.rows) expect(row.detail).not.toBe('');
    }
  });
});
