import { CONFIG } from '../config';
import { xpForLevel } from '../systems/progression';
import { MAX_ENEMY_XP } from '../data/enemies';

/**
 * What a run is worth, and what a claimed run may not be.
 *
 * Kept free of the DOM and of any network code so both halves can be tested in
 * Node — and so the *same* rules are available to the client and to whatever
 * accepts a submission. A leaderboard that ranks one way on screen and another
 * way on the server is a leaderboard nobody trusts twice.
 *
 * Nothing here is secret. A player can read these bounds in the bundle, and
 * that is fine: they exist to make a forged score expensive to construct, not
 * impossible to imagine. What they buy is that a number typed into a console
 * has to at least describe a run the game could have produced.
 */

/** A run as the board records it. Ordered by `compareScores`. */
export interface Score {
  /** What the player wants to be called. Trimmed, length-capped, never empty. */
  readonly name: string;
  /** Run time in whole milliseconds — an integer, so nothing rounds twice. */
  readonly timeMs: number;
  readonly kills: number;
  readonly level: number;
  readonly bosses: number;
  /** Which weapon the run opened with, so the board says how it was won. */
  readonly weapon: string;
  /** The run's seed, so any entry on the board can be replayed with `?seed=`. */
  readonly seed: number;
}

/** How many entries the board keeps. Everything below this rank is forgotten. */
export const BOARD_SIZE = 100;

/** Longest name the board will take, in characters. */
export const MAX_NAME_LENGTH = 18;

/**
 * Ranking, best first.
 *
 * Time survived is the score, because it is what the game itself says the
 * score is: the run has no finish line, so how long you lasted is the whole
 * achievement. Bosses and kills only break ties, and they break them in that
 * order — a boss is the harder thing to have done.
 */
export function compareScores(a: Score, b: Score): number {
  if (a.timeMs !== b.timeMs) return b.timeMs - a.timeMs;
  if (a.bosses !== b.bosses) return b.bosses - a.bosses;
  return b.kills - a.kills;
}

/**
 * The board, best first, one entry per name, cut to `BOARD_SIZE`.
 *
 * One row per name rather than per run, the way an arcade cabinet does it: a
 * player who is simply playing more than everybody else would otherwise own
 * the whole table, and a hundred rows by one person is not a leaderboard.
 * Names are not accounts and nothing stops two people picking the same one —
 * that is the price of having no logins, and it is the right price here.
 */
export function rankScores(scores: readonly Score[], limit = BOARD_SIZE): Score[] {
  const best = new Map<string, Score>();

  for (const score of scores) {
    const key = score.name.toLocaleLowerCase();
    const held = best.get(key);
    if (held === undefined || compareScores(score, held) < 0) best.set(key, score);
  }

  return [...best.values()].sort(compareScores).slice(0, limit);
}

/**
 * Where a score would land, or -1 if it would not make the board at all.
 *
 * Asked before anything is sent, so a run that cannot place is never offered a
 * name prompt it would be disappointed by.
 */
export function rankOf(score: Score, board: readonly Score[], limit = BOARD_SIZE): number {
  const placed = rankScores([...board, score], limit).findIndex(
    (entry) => entry.name.toLocaleLowerCase() === score.name.toLocaleLowerCase(),
  );
  return placed;
}

/**
 * Cleans a name up, or rejects it.
 *
 * Control characters are stripped rather than refused: they arrive from paste
 * and from phone keyboards without anybody meaning them, and a submission
 * refused for an invisible reason reads as the board being broken.
 */
export function cleanName(raw: string): string | null {
  let kept = '';
  for (const character of raw) {
    if (isNameCharacter(character.codePointAt(0) ?? 0)) kept += character;
  }

  const trimmed = kept.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

/**
 * Whether a code point may appear in a name.
 *
 * A test rather than a character class, because the class would have to be
 * written as literal control characters or as escapes, and both are things
 * an editor or a copy-paste can quietly corrupt into a regex that matches
 * something else entirely. Ranges named in hex say what they mean.
 */
function isNameCharacter(point: number): boolean {
  if (point < 0x20) return false; // C0 controls, newlines included
  if (point >= 0x7f && point <= 0x9f) return false; // DEL and the C1 block
  if (point >= 0x200b && point <= 0x200f) return false; // zero-width joiners and marks
  if (point === 0x2028 || point === 0x2029) return false; // line and paragraph separators
  // Bidi embeddings, overrides and isolates. Unlike everything above these are
  // not accidents: they reorder the glyphs around them, so one name carrying an
  // override can rewrite how its neighbours read on a public board.
  if (point >= 0x202a && point <= 0x202e) return false;
  if (point >= 0x2066 && point <= 0x2069) return false;
  return true;
}

/**
 * The most kills a run of this length could possibly have made.
 *
 * Not a guess: the spawner has a hard ceiling on how many bodies exist at once
 * and a floor on how often it may deliver a batch, so a run cannot kill faster
 * than the game can supply. The floor on the interval is what makes this
 * finite — `spawnInterval` never returns less than it, whatever the wave and
 * the minute.
 *
 * Deliberately generous. This is a bound on the impossible, not a target: it
 * has to be wrong in the player's favour for every real run, including one
 * played better than anybody here has managed, or it becomes a rule that a
 * good player runs into.
 */
export function killCeiling(timeMs: number): number {
  const seconds = timeMs / 1000;
  const minutes = seconds / 60;

  // The biggest batch the spawner will ever deliver at this point in the run,
  // arriving as often as it is allowed to.
  const batch = 1 + Math.floor(minutes * CONFIG.spawn.batchPerMinute);
  const perSecond = batch / MIN_SPAWN_INTERVAL;

  // Splitters put bodies on the field the spawner never budgeted for — but
  // only briefly: `bodyCost` charges the spawn timer for every extra child, so
  // over a run the budget is conserved on purpose. This covers the transient,
  // not a second horde.
  const spawned = perSecond * seconds * SPLIT_ALLOWANCE;

  // Everything alive at the bell could still be killed on the last tick.
  return Math.ceil(spawned + CONFIG.spawn.maxEnemies + KILL_SLACK);
}

/** The shortest gap `spawnInterval` can return, whatever the minute. */
const MIN_SPAWN_INTERVAL = 0.05;
/**
 * Headroom for enemies that arrive by splitting rather than by spawning.
 *
 * Half again, not triple: the spawner pays itself back for them. Even at this
 * the bound sits about eight times above the best kill rate the stand has ever
 * measured, which is the direction it has to be wrong in.
 */
const SPLIT_ALLOWANCE = 1.5;
/** Absolute slack, so a short run is never bounded to almost nothing. */
const KILL_SLACK = 200;

/**
 * The highest level this many kills could possibly have paid for.
 *
 * XP has exactly one source — a gem dropped by a kill — so the most XP a run
 * can hold is every kill dropping the richest gem in the game. Levels are
 * quadratic, so this converges fast and the bound stays tight enough to be
 * worth checking.
 */
export function levelCeiling(kills: number): number {
  let budget = kills * MAX_ENEMY_XP;
  let level = 1;

  while (level < LEVEL_HARD_CAP) {
    const cost = xpForLevel(level);
    if (cost > budget) break;
    budget -= cost;
    level++;
  }

  return level;
}

/**
 * Stops `levelCeiling` walking forever on an absurd kill count.
 *
 * Reached only by a claim that is already impossible, so the exact number does
 * not matter — it just has to be past anything a real run reaches. The longest
 * measured run on the endless stand ended at level 118.
 */
const LEVEL_HARD_CAP = 10_000;

/**
 * The most bosses a run of this length could have felled.
 *
 * The only exact bound of the three. The first boss arrives on the interval
 * and the clock for the next starts when the last one *died*, so a run cannot
 * have felled more than one per interval however well it is played — the duel
 * itself takes time this ignores, which is what keeps it a ceiling.
 */
export function bossCeiling(timeMs: number): number {
  return Math.floor(timeMs / 1000 / CONFIG.boss.interval);
}

/** Why a submission was refused, or null when it looks like a real run. */
export type ScoreFault =
  | 'name'
  | 'time'
  | 'kills'
  | 'level'
  | 'bosses'
  | 'shape';

/**
 * Whether a claimed run is one this game could have produced.
 *
 * Every bound is read from the same constants the simulation runs on, so a
 * change to the spawn curve or the boss cadence moves the rules with it. A
 * hand-typed copy of these numbers would be wrong the first time somebody
 * retuned the game and nobody would notice until a real run was refused.
 *
 * This cannot prove a run happened. It can only refuse the ones that could
 * not have — which is the whole of what a client-side game can honestly
 * promise, and worth saying out loud rather than implying more.
 */
export function faultInScore(score: Score): ScoreFault | null {
  if (!Number.isFinite(score.timeMs) || !Number.isInteger(score.timeMs)) return 'shape';
  if (!Number.isInteger(score.kills) || !Number.isInteger(score.level)) return 'shape';
  if (!Number.isInteger(score.bosses) || !Number.isInteger(score.seed)) return 'shape';

  if (cleanName(score.name) !== score.name) return 'name';

  if (score.timeMs < 0 || score.timeMs > MAX_RUN_MS) return 'time';
  if (score.kills < 0 || score.kills > killCeiling(score.timeMs)) return 'kills';
  if (score.level < 1 || score.level > levelCeiling(score.kills)) return 'level';
  if (score.bosses < 0 || score.bosses > bossCeiling(score.timeMs)) return 'bosses';

  return null;
}

/**
 * The longest run the board will believe, in milliseconds.
 *
 * Twenty-four hours. Not a balance number and not derived from one: it is the
 * point past which a claim stops being a run and starts being a browser tab
 * somebody left open, and the difference matters because the game pauses
 * itself when the window loses focus.
 */
export const MAX_RUN_MS = 24 * 60 * 60 * 1000;
