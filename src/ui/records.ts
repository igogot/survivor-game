import { formatTime, requireElement } from './hud';
import { BOARD_SIZE, MAX_NAME_LENGTH, cleanName, nameKey, rankOf } from '../core/scores';
import { weaponById } from '../data/weapons';
import { loadIdentity } from '../net/identity';
import { t, weaponName } from '../i18n';
import type { Leaderboard, SubmitFailure } from '../net/leaderboard';
import type { BoardKind, Score } from '../core/scores';
import type { StringId } from '../i18n/en';
import type { World } from '../world/world';

/**
 * The board, and the one place a run can be put on it.
 *
 * Everything here is written so that a leaderboard nobody can reach costs the
 * player nothing. The board is not part of the game loop, the run is already
 * over by the time any of this appears, and every path through it ends with a
 * screen that says what happened rather than a spinner that never stops. A
 * game that will not let you press "run again" because a shared host in
 * another country is down is a worse game than one with no board at all.
 */

/** What the run just played would look like on the board. */
export function scoreOfRun(world: World, name: string): Score {
  return {
    name,
    // Rounded once, here, so the number the board holds is the number the
    // result screen showed.
    timeMs: Math.round(world.time * 1000),
    kills: world.kills,
    // The party's level and the first player's weapon: the board is a solo
    // table, and a solo run has exactly one of each.
    level: world.level,
    bosses: world.bossesKilled,
    weapon: world.players[0].starterId,
    seed: world.seed,
    // The roster, not the survivors. A four that lost two still set a record
    // as a four, and scoring it as a pair would flatter it.
    party: world.players.length,
  };
}

/** The full table, opened from the opening screen and from the result screen. */
export class RecordsScreen {
  private readonly root = requireElement('records');
  private readonly body = requireElement('records-body');
  private readonly status = requireElement('records-status');
  private readonly closeButton = requireElement('records-close');
  private readonly tabs = new Map<BoardKind, HTMLElement>([
    ['solo', requireElement('records-tab-solo')],
    ['party', requireElement('records-tab-party')],
  ]);

  /**
   * The last board of each kind, so reopening is instant and offline still
   * shows something. Kept per kind rather than one slot, or switching tabs
   * would blank the one you came from every time.
   */
  private readonly cached = new Map<BoardKind, readonly Score[]>();

  /** Which board is on screen. Solo, because most runs are. */
  private showing: BoardKind = 'solo';

  constructor(
    private readonly board: Leaderboard,
    onClose: () => void,
  ) {
    this.closeButton.addEventListener('click', onClose);

    for (const [kind, tab] of this.tabs) {
      tab.addEventListener('click', () => {
        if (this.showing === kind) return;
        this.showing = kind;
        void this.show(this.highlight);
      });
    }
  }

  /** The name to pick out of the rows, remembered across a tab switch. */
  private highlight: string | undefined;

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows what is known immediately, then refreshes behind it. */
  async show(highlight?: string): Promise<void> {
    this.highlight = highlight;
    this.root.hidden = false;

    const kind = this.showing;
    this.markTabs();
    const held = this.cached.get(kind) ?? [];
    this.render(held, highlight);
    this.status.textContent = t('board.loading');

    const result = await this.board.read(kind);
    // Gone, or the player switched tabs while this was in the air — either way
    // this answer is about a screen that is no longer up.
    if (this.root.hidden || this.showing !== kind) return;

    if (!result.reachable) {
      this.status.textContent = t(held.length > 0 ? 'board.offlineStale' : 'board.offlineEmpty');
      return;
    }

    this.cached.set(kind, result.board);
    this.status.textContent = result.board.length === 0 ? t('board.empty') : '';
    this.render(result.board, highlight);
  }

  /**
   * Opens on the board a run belongs to.
   *
   * Somebody who just finished a party run wants to see where it landed, not
   * the solo hundred it was never on.
   */
  async showFor(kind: BoardKind, highlight?: string): Promise<void> {
    this.showing = kind;
    await this.show(highlight);
  }

  private markTabs(): void {
    for (const [kind, tab] of this.tabs) {
      tab.setAttribute('aria-pressed', String(kind === this.showing));
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** A board this screen last saw, for deciding whether a run qualifies. */
  known(kind: BoardKind): readonly Score[] {
    return this.cached.get(kind) ?? [];
  }

  private render(board: readonly Score[], highlight?: string): void {
    this.body.replaceChildren(
      ...board.map((entry, index) => row(entry, index, matches(entry.name, highlight))),
    );
  }
}

function matches(name: string, highlight?: string): boolean {
  return highlight !== undefined && nameKey(name) === nameKey(highlight);
}

function row(entry: Score, index: number, mine: boolean): HTMLElement {
  const line = document.createElement('li');
  line.className = mine ? 'record record--mine' : 'record';

  line.append(
    cell('rank', `${index + 1}`),
    // The host's name, and how many of them there were. Written as a figure
    // rather than a word because the row is narrow and "×4" needs no
    // translating — the alternative is a plural rule per language for a label
    // two characters wide.
    who(entry),
    cell('when', formatTime(entry.timeMs / 1000)),
    cell('with', weaponFor(entry.weapon)),
    cell('felled', entry.bosses > 0 ? `${entry.bosses}★` : ''),
  );

  return line;
}

/**
 * A weapon's name in the reader's language, or a dash.
 *
 * A row can name a weapon this build no longer has — the board outlives any
 * one version of the game — so a missing definition is a dash rather than a
 * blank cell or a thrown error.
 */
function weaponFor(id: string): string {
  const def = weaponById(id);
  return def === undefined ? '—' : weaponName(def);
}

/**
 * The name, plus the size of the party behind it on the party board.
 *
 * Only the host's name is on a party row: names do not travel between players,
 * so the host is the one who filed it and the one accountable for it. The
 * count is what says it was not a solo run.
 */
function who(entry: Score): HTMLElement {
  const holder = cell('who', entry.name);
  if (entry.party > 1) {
    const size = document.createElement('span');
    size.className = 'party-size';
    size.textContent = ` ×${entry.party}`;
    holder.append(size);
  }
  return holder;
}

function cell(className: string, text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/**
 * The strip on the result screen that offers to put a run on the board.
 *
 * Only ever appears when the run would actually place. Offering a name box to
 * somebody whose run cannot make the top hundred is asking them to type
 * something in order to be told no.
 */
export class SubmitStrip {
  private readonly root = requireElement('submit-strip');
  private readonly message = requireElement('submit-message');
  private readonly form = requireElement('submit-form');
  private readonly input = requireElement('submit-name') as HTMLInputElement;
  private readonly button = requireElement('submit-send') as HTMLButtonElement;

  private pending: Score | null = null;

  constructor(
    private readonly board: Leaderboard,
    private readonly onPlaced: (name: string) => void,
  ) {
    this.input.maxLength = MAX_NAME_LENGTH;
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.send();
    });
  }

  /**
   * Works out whether this run belongs on the board, and says so.
   *
   * The check is made against the board as last fetched. It can be out of date
   * by a few entries, and that is fine in both directions: a run offered a
   * name box that then fails to place is told so, and one that would have
   * placed is never silently dropped — the server has the last word either
   * way.
   */
  async offer(world: World, known: readonly Score[], reachable: boolean): Promise<void> {
    this.form.hidden = true;
    this.pending = null;

    if (!reachable) {
      this.show(t('board.unreachable'));
      return;
    }

    const name = loadIdentity().name;
    const candidate = scoreOfRun(world, name === '' ? 'you' : name);
    const place = rankOf(candidate, known);

    if (place < 0) {
      const worst = known[known.length - 1];
      this.show(
        known.length < BOARD_SIZE
          ? t('board.missed')
          : t('board.missedBy', { size: BOARD_SIZE, time: formatTime(worst.timeMs / 1000) }),
      );
      return;
    }

    this.pending = candidate;
    this.input.value = name;
    this.button.disabled = false;
    this.form.hidden = false;
    this.show(t('board.qualifies', { place: ordinal(place + 1) }));
  }

  hide(): void {
    this.root.hidden = true;
  }

  private show(text: string): void {
    this.message.textContent = text;
    this.root.hidden = false;
  }

  private async send(): Promise<void> {
    const candidate = this.pending;
    if (candidate === null) return;

    const name = cleanName(this.input.value);
    if (name === null) {
      this.show(t('board.needName'));
      this.form.hidden = false;
      return;
    }

    // Disabled for the whole round trip: the endpoint is rate limited, and a
    // double click is the easiest way to spend that limit on nothing.
    this.button.disabled = true;
    this.show(t('board.sending'));

    const result = await this.board.submit({ ...candidate, name });

    if (!result.ok) {
      this.button.disabled = false;
      this.form.hidden = false;
      this.show(t(FAILURE_TEXT[result.reason]));
      return;
    }

    this.form.hidden = true;
    this.pending = null;
    this.show(
      result.rank >= 0
        ? t('board.placed', { place: ordinal(result.rank + 1) })
        : t('board.placedLate'),
    );
    this.onPlaced(name);
  }
}

/**
 * What each refusal says out loud.
 *
 * `refused` is the interesting one. It means the server did not believe the
 * run, and the only honest thing to do is say so plainly rather than blame the
 * network — somebody who edited a number should be told they were caught, and
 * somebody who did not needs to know it is not worth retrying.
 */
const FAILURE_TEXT: Readonly<Record<SubmitFailure, StringId>> = {
  offline: 'board.failOffline',
  refused: 'board.failRefused',
  'too-many': 'board.failTooMany',
  invalid: 'board.failInvalid',
  'name-taken': 'board.failNameTaken',
};

function ordinal(place: number): string {
  const rest = place % 100;
  if (rest >= 11 && rest <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}
