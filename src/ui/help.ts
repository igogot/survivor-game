import { CONFIG } from '../config';
import { BOSS } from '../data/enemies';
import { WEAPONS } from '../data/weapons';
import { OFFERS_PER_LEVEL } from '../systems/progression';
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

/**
 * One line per weapon, keyed by id.
 *
 * Kept beside the help text rather than on the weapon definition: a definition
 * is numbers the simulation reads, and this is prose only the panel needs.
 * tests/help.test.ts fails if a weapon reaches `WEAPONS` without a line here,
 * which is the part that would otherwise rot in silence.
 */
const WEAPON_ROLES: Readonly<Record<string, string>> = {
  bolt: 'Fires at the nearest enemy in range. The only weapon that reaches across the screen, and the only one you start with.',
  orbit: 'Blades circle you and cut what they touch. They guard the ground you are standing on, not the ground ahead.',
  nova: 'A burst of damage around you every few seconds. It does not care how many enemies are caught in it.',
};

export function helpSections(): readonly HelpSection[] {
  return [theDeal(), controls(), theLoop(), weaponRows(), dangers()];
}

function theDeal(): HelpSection {
  return {
    title: 'The deal',
    rows: [
      {
        kind: 'note',
        term: 'You never attack',
        detail:
          'Every weapon fires itself, at whatever is nearest. The only decision your hands make is where to stand.',
      },
      {
        kind: 'note',
        term: 'Waiting does not work',
        detail: `Enemies arrive faster and tougher every minute and never stop coming. At ${formatTime(CONFIG.runDuration)} the horde breaks off and the boss arrives.`,
      },
      {
        kind: 'note',
        term: 'One life',
        detail:
          'Nothing heals you except a Vitality card, and that only pays back the health it adds. Damage taken is gone for the rest of the run.',
      },
    ],
  };
}

function controls(): HelpSection {
  return {
    title: 'Controls',
    rows: [
      {
        kind: 'keys',
        keys: ['W', 'A', 'S', 'D'],
        detail: 'Move. Arrow keys do the same thing.',
        audience: 'keys',
      },
      {
        kind: 'keys',
        keys: [],
        gesture: 'Drag anywhere',
        detail:
          'A stick appears under your thumb wherever it lands. How far you push it is how fast you go, so a small push is a slow, precise step.',
        audience: 'touch',
      },
      {
        kind: 'keys',
        keys: Array.from({ length: OFFERS_PER_LEVEL }, (_, index) => String(index + 1)),
        detail: 'Take that upgrade. Clicking the card does the same.',
        audience: 'keys',
      },
      {
        kind: 'keys',
        keys: [],
        gesture: 'Tap a card',
        detail: 'Take that upgrade.',
        audience: 'touch',
      },
      { kind: 'keys', keys: ['Esc'], detail: 'Pause. So does P.', audience: 'keys' },
      {
        kind: 'keys',
        keys: [],
        gesture: 'The pause button',
        detail: 'Freezes the run. The round button in the bottom corner, always on screen.',
        audience: 'touch',
      },
      {
        kind: 'keys',
        keys: ['R'],
        detail: 'Start over. On the pause screen it asks twice before throwing the run away.',
        audience: 'keys',
      },
      {
        kind: 'note',
        term: 'Leaving the window',
        detail:
          'Clicking away pauses the run on its own. Coming back does not resume it — you get to look at the screen first.',
      },
    ],
  };
}

function theLoop(): HelpSection {
  return {
    title: 'How you get stronger',
    rows: [
      {
        kind: 'note',
        term: 'Kills drop gems',
        detail: `Walk over a gem to take it, or let it come to you — anything within ${CONFIG.player.pickupRadius} pixels flies in on its own.`,
      },
      {
        kind: 'note',
        term: 'Gems are the only XP',
        detail:
          'An enemy you hurt but did not kill is worth nothing, and one that wanders off the map takes its gem with it.',
      },
      {
        kind: 'note',
        term: 'Levels are the only upgrades',
        detail: `Each level stops the run and offers ${OFFERS_PER_LEVEL} cards. There is no shop and nothing to save for: what you pick is what you get.`,
      },
      {
        kind: 'note',
        term: 'Cards stack',
        detail:
          'A card naming a weapon you do not own grants it; taking it again levels it. Every card says how many times it can still be taken.',
      },
    ],
  };
}

function weaponRows(): HelpSection {
  return {
    title: 'The weapons',
    rows: WEAPONS.map((def) => ({
      kind: 'note' as const,
      term: def.name,
      detail: WEAPON_ROLES[def.id] ?? '',
    })),
  };
}

function dangers(): HelpSection {
  return {
    title: 'What kills you',
    rows: [
      {
        kind: 'note',
        term: 'Touching anything hurts',
        detail: `Contact costs health and buys ${CONFIG.player.invulnTime} seconds of grace. Standing inside a crowd spends that grace the moment it runs out, over and over.`,
      },
      {
        kind: 'note',
        term: 'They aim where you are going',
        detail:
          'Most spawns are placed in your path rather than behind you, so running in a straight line runs you into the next wave.',
      },
      {
        kind: 'note',
        term: 'The boss',
        detail: `It arrives with ${BOSS.hp} health and hits for ${BOSS.damage}. Nothing else spawns while it lives — fell it and the run is won.`,
      },
      {
        kind: 'note',
        term: 'If you remember one thing',
        detail: 'Keep moving, and never let a crowd close around you. Standing still is what ends runs.',
      },
    ],
  };
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
