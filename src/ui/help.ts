import { CONFIG } from '../config';
import { BOSS } from '../data/enemies';
import { WEAPONS } from '../data/weapons';
import { OFFERS_PER_LEVEL } from '../systems/progression';
import { t, weaponName, weaponRole } from '../i18n';
import { formatTime } from './hud';

/**
 * The rules, in one place.
 *
 * The panel is shown three times — before the first run, on every pause and
 * over the result screen — and a player who reads it there should not then be
 * surprised by the game. So the numbers in it are read from the constants the
 * simulation uses rather than typed out: a spawn curve or a card count that
 * changes must not leave a confident sentence behind saying otherwise.
 *
 * The words come from `src/i18n`, the numbers from `CONFIG`, and the structure
 * is here. That split is what lets the panel be translated without any sentence
 * getting the chance to hardcode a number on the way through.
 *
 * The content is data and rendering is a separate pass over it. That is what
 * lets tests/help.test.ts assert what the panel says without a DOM — that every
 * weapon is described, that the key hints match the number of cards actually
 * offered.
 */

/**
 * Which input a row belongs to.
 *
 * A phone has no Esc key and a desktop has no thumb, and showing both sets to
 * everybody is how a help panel starts lying to half its readers. The renderer
 * turns this into the same `touch-only` class the pause button already uses, so
 * the choice is made by a media query rather than by a guess at load time — a
 * laptop with a touchscreen is both.
 */
export type HelpAudience = 'touch' | 'keys' | 'both';

/** A key or gesture, and what it does. */
export interface HelpKeyRow {
  readonly kind: 'keys';
  /** Rendered as separate keycaps. Empty when the row describes a gesture. */
  readonly keys: readonly string[];
  /** Shown in place of keycaps when there is no key to press. */
  readonly gesture?: string;
  readonly detail: string;
  readonly audience: HelpAudience;
}

/** A named piece of the game, and what the player needs to know about it. */
export interface HelpNoteRow {
  readonly kind: 'note';
  readonly term: string;
  readonly detail: string;
}

export type HelpRow = HelpKeyRow | HelpNoteRow;

export interface HelpSection {
  readonly title: string;
  readonly rows: readonly HelpRow[];
}

export function helpSections(): readonly HelpSection[] {
  return [theDeal(), controls(), theLoop(), weaponRows(), dangers()];
}

function theDeal(): HelpSection {
  return {
    title: t('help.section.deal'),
    rows: [
      note('help.deal.attack.term', 'help.deal.attack.detail'),
      {
        kind: 'note',
        term: t('help.deal.finish.term'),
        detail: t('help.deal.finish.detail', { interval: formatTime(CONFIG.boss.interval) }),
      },
      note('help.deal.life.term', 'help.deal.life.detail'),
      note('help.deal.score.term', 'help.deal.score.detail'),
    ],
  };
}

function controls(): HelpSection {
  return {
    title: t('help.section.controls'),
    rows: [
      {
        kind: 'keys',
        keys: ['W', 'A', 'S', 'D'],
        detail: t('help.controls.move.detail'),
        audience: 'keys',
      },
      {
        kind: 'keys',
        keys: [],
        gesture: t('help.controls.click.gesture'),
        detail: t('help.controls.click.detail'),
        audience: 'keys',
      },
      {
        kind: 'keys',
        keys: [],
        gesture: t('help.controls.drag.gesture'),
        detail: t('help.controls.drag.detail'),
        audience: 'touch',
      },
      {
        kind: 'keys',
        keys: Array.from({ length: OFFERS_PER_LEVEL }, (_, index) => String(index + 1)),
        // One row for both menus, because it is one gesture: the chest screen
        // is the level-up screen with different cards on it.
        detail: t('help.controls.cards.detail'),
        audience: 'keys',
      },
      {
        kind: 'keys',
        keys: [],
        gesture: t('help.controls.tap.gesture'),
        detail: t('help.controls.tap.detail'),
        audience: 'touch',
      },
      {
        kind: 'keys',
        keys: ['Esc'],
        detail: t('help.controls.pause.detail'),
        audience: 'keys',
      },
      {
        kind: 'keys',
        keys: [],
        gesture: t('help.controls.pauseButton.gesture'),
        detail: t('help.controls.pauseButton.detail'),
        audience: 'touch',
      },
      {
        kind: 'keys',
        keys: ['R'],
        detail: t('help.controls.restart.detail'),
        audience: 'keys',
      },
      note('help.controls.blur.term', 'help.controls.blur.detail'),
    ],
  };
}

function theLoop(): HelpSection {
  return {
    title: t('help.section.loop'),
    rows: [
      {
        kind: 'note',
        term: t('help.loop.gems.term'),
        detail: t('help.loop.gems.detail', { radius: CONFIG.player.pickupRadius }),
      },
      note('help.loop.xp.term', 'help.loop.xp.detail'),
      note('help.loop.chest.term', 'help.loop.chest.detail'),
      note('help.loop.spoil.term', 'help.loop.spoil.detail'),
      note('help.loop.starter.term', 'help.loop.starter.detail'),
      {
        kind: 'note',
        term: t('help.loop.levels.term'),
        detail: t('help.loop.levels.detail', { offers: OFFERS_PER_LEVEL }),
      },
      note('help.loop.stack.term', 'help.loop.stack.detail'),
    ],
  };
}

function weaponRows(): HelpSection {
  return {
    title: t('help.section.weapons'),
    rows: WEAPONS.map((def) => ({
      kind: 'note' as const,
      term: weaponName(def),
      detail: weaponRole(def.id),
    })),
  };
}

function dangers(): HelpSection {
  return {
    title: t('help.section.dangers'),
    rows: [
      {
        kind: 'note',
        term: t('help.danger.touch.term'),
        detail: t('help.danger.touch.detail', { grace: CONFIG.player.invulnTime }),
      },
      note('help.danger.aim.term', 'help.danger.aim.detail'),
      {
        kind: 'note',
        term: t('help.danger.boss.term'),
        detail: t('help.danger.boss.detail', {
          hp: BOSS.hp,
          damage: BOSS.damage,
          duel: CONFIG.boss.duelGrace,
        }),
      },
      note('help.danger.remember.term', 'help.danger.remember.detail'),
    ],
  };
}

/** The common shape: a term and a detail, both straight out of the tables. */
function note(term: Parameters<typeof t>[0], detail: Parameters<typeof t>[0]): HelpNoteRow {
  return { kind: 'note', term: t(term), detail: t(detail) };
}

/**
 * Fills `into` with the panel markup.
 *
 * Built from nodes rather than a template string: the text comes from weapon
 * names and tuned constants, and an `innerHTML` here would turn any future
 * angle bracket in that data into a rendering bug.
 */
export function renderHelp(into: HTMLElement): void {
  into.replaceChildren(...helpSections().map(renderSection));
}

function renderSection(section: HelpSection): HTMLElement {
  const root = document.createElement('section');
  root.className = 'help-section';

  const title = document.createElement('h3');
  title.textContent = section.title;

  const list = document.createElement('dl');
  for (const row of section.rows) list.append(...renderRow(row));

  root.append(title, list);
  return root;
}

function renderRow(row: HelpRow): readonly HTMLElement[] {
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  detail.textContent = row.detail;

  switch (row.kind) {
    case 'keys': {
      if (row.audience !== 'both') {
        const scope = row.audience === 'touch' ? 'touch-only' : 'keys-only';
        term.classList.add(scope);
        detail.classList.add(scope);
      }
      if (row.gesture !== undefined) {
        term.textContent = row.gesture;
        term.classList.add('help-gesture');
      } else {
        term.append(...row.keys.map(keycap));
      }
      break;
    }
    case 'note':
      term.textContent = row.term;
      break;
    default: {
      // Exhaustiveness check: a new row kind stops compiling rather than
      // rendering as a blank line.
      const unhandled: never = row;
      throw new Error(`Unhandled help row: ${String(unhandled)}`);
    }
  }

  return [term, detail];
}

function keycap(label: string): HTMLElement {
  const key = document.createElement('kbd');
  key.textContent = label;
  return key;
}
