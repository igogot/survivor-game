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

it('plays a full run on every seed', () => {
  const rows: string[] = ['seed      time   outcome   kills   level'];

  let wins = 0;
  let reachedBoss = 0;
  let totalTime = 0;

  for (const seed of SEEDS) {
    // Enough headroom past the timer for the boss fight itself.
    const world = runBot(seed, CONFIG.runDuration + 120);
    const won = world.phase === 'won';

    if (won) wins++;
    if (world.bossSpawned) reachedBoss++;
    totalTime += world.time;

    rows.push(
      [
        String(seed).padEnd(9),
        `${world.time.toFixed(0)}s`.padStart(5),
        (won ? 'won' : 'died').padStart(9),
        String(world.kills).padStart(8),
        String(world.player.level).padStart(8),
      ].join(''),
    );
  }

  rows.push('');
  rows.push(
    `reached the boss: ${reachedBoss}/${SEEDS.length}   won: ${wins}/${SEEDS.length}   average run: ${(totalTime / SEEDS.length).toFixed(0)}s`,
  );
  console.log('\n' + rows.join('\n') + '\n');

  // Guard rails rather than a target: a run this bot can never finish is not a
  // game, and one it always finishes is not a roguelite.
  expect(wins).toBeGreaterThan(0);
  expect(wins).toBeLessThan(SEEDS.length);
});
