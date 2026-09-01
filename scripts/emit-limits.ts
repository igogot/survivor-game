/**
 * Writes the bounds the API checks against, read from the game's own constants.
 *
 * The server is PHP and the game is TypeScript, so the two cannot share a
 * module — and a hand-copied set of numbers in `scores.php` would be wrong the
 * first time anybody retuned the spawn curve or the boss cadence. Nobody would
 * notice until a real run was refused, which is the worst possible way to find
 * out.
 *
 * So the numbers travel with the build instead. This runs before `vite build`,
 * writes `public/api/limits.json`, and Vite copies `public/` into `dist/` — the
 * same directory the FTP deploy uploads. The API reads the file next to it.
 *
 * The curves are sampled rather than described, because `killCeiling` is a
 * function and JSON is not: the table holds the ceiling at a spread of run
 * lengths and PHP interpolates between them. Sampling is what lets the shape of
 * the bound change here without the server learning any arithmetic.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config';
import {
  BOARD_SIZES,
  BOARD_SIZE,
  MAX_PARTY,
  MAX_NAME_LENGTH,
  MAX_RUN_MS,
  bossCeiling,
  killCeiling,
  levelCeiling,
} from '../src/core/scores';

/** Run lengths the kill ceiling is sampled at, in seconds. */
const TIME_SAMPLES = [0, 30, 60, 120, 300, 600, 1200, 2400, 4800, 14_400, 86_400];

/** Kill counts the level ceiling is sampled at. */
const KILL_SAMPLES = [0, 10, 50, 200, 1000, 5000, 20_000, 100_000, 500_000, 5_000_000];

const limits = {
  // Stamped so a mismatch between the game and the API is visible rather than
  // silent: the client sends this and the server refuses a different one.
  boardSize: BOARD_SIZE,
  boardSizes: BOARD_SIZES,
  maxParty: MAX_PARTY,
  /*
   * How a party's multiplier is split between arrivals and health.
   *
   * The API needs it to bound a party's kills, and it is a tuning knob rather
   * than a constant — sending it means the endpoint follows the game instead
   * of carrying a copy that goes stale the first time it moves.
   */
  perPlayerArrivals: CONFIG.spawn.perPlayerArrivals,
  maxNameLength: MAX_NAME_LENGTH,
  maxRunMs: MAX_RUN_MS,
  bossIntervalSeconds: CONFIG.boss.interval,
  // Both curves are monotonic, so the server can bracket a value between two
  // samples and take the upper one — which errs towards accepting, exactly the
  // direction a bound on the impossible should err in.
  killCeiling: TIME_SAMPLES.map((seconds) => [seconds, killCeiling(seconds * 1000)]),
  levelCeiling: KILL_SAMPLES.map((kills) => [kills, levelCeiling(kills)]),
  // Exact, so it is sent as the rule rather than as samples.
  bossesPerInterval: bossCeiling(CONFIG.boss.interval * 1000),
};

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/api/limits.json');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(limits, null, 2)}\n`, 'utf8');

console.log(`limits.json written for a board of ${BOARD_SIZE}`);
