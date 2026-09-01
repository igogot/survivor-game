import { expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { runBot } from './bot';

/**
 * Balance measured instead of guessed.
 *
 * The bot in tests/bot.ts is a fixed, deterministic player, so any change in
 * this table comes from a change in the game and not from luck. Run it with
 * `npm run balance` after touching a spawn curve, a weapon or an upgrade.
 */
const SEEDS = [42, 1337, 99, 7, 11, 2024, 5, 808];

/**
 * How long each run is watched.
 *
 * A run has no length any more — the only ending is death — so this is a
 * window, not a duration. It holds the first boss and the two minutes after it,
 * which is where the interesting part of the table has always been, and it
 * keeps the stand at about a minute and a half. A bot still alive at the bell
 * is reported as alive rather than counted as a loss.
 */
const WINDOW = CONFIG.boss.interval + 120;

it('plays a full run on every seed', () => {
  const rows: string[] = ['seed      time   outcome   kills   level   bosses'];

  let felledOne = 0;
  let died = 0;
  let reachedBoss = 0;
  let totalTime = 0;

  for (const seed of SEEDS) {
    const world = runBot(seed, WINDOW);
    const alive = world.phase !== 'dead';

    if (world.bossesKilled > 0) felledOne++;
    if (!alive) died++;
    if (world.time >= CONFIG.boss.interval) reachedBoss++;
    totalTime += world.time;

    rows.push(
      [
        String(seed).padEnd(9),
        `${world.time.toFixed(0)}s`.padStart(5),
        (alive ? 'alive' : 'died').padStart(9),
        String(world.kills).padStart(8),
        String(world.level).padStart(8),
        String(world.bossesKilled).padStart(9),
      ].join(''),
    );
  }

  const average = (totalTime / SEEDS.length).toFixed(0);
  rows.push('');
  rows.push(
    `reached the boss: ${reachedBoss}/${SEEDS.length}   ` +
      `felled one: ${felledOne}/${SEEDS.length}   average run: ${average}s`,
  );
  console.log('\n' + rows.join('\n') + '\n');

  // Guard rails rather than a target, and the same two the win column used to
  // hold: a boss this bot can never fell is not a game, and a window it always
  // survives is not a roguelite.
  expect(felledOne).toBeGreaterThan(0);
  expect(died).toBeGreaterThan(0);
});
