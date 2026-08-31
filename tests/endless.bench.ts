import { expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { runBot } from './bot';
import type { World } from '../src/world/world';

/**
 * The stand for the part of the run `npm run balance` cannot see.
 *
 * That one measures a twelve-minute window, which was the whole game when the
 * boss ended it. It is not the whole game any more, and nothing was watching
 * the rest: a bot left alone reached minute ninety, level 118 and a quarter of
 * a million kills without ever dropping below half health. Numbers drift when
 * nobody measures them, so this measures them.
 *
 * What it reports is deliberately not "did the bot win" — there is nothing to
 * win. It is "what was happening to the player", and the column that matters is
 * `hits/min`: how often the horde actually lands a blow. A run nobody can lose
 * shows up there long before it shows up in a survival time.
 */
const SEEDS = [42, 1337, 99, 7, 11, 2024, 5, 808];

/** Forty minutes. Long enough for three or four bosses on a run that lives. */
const CAP = 2400;

/** Minute after which a run counts as "late" for the hit-rate column. */
const LATE_AFTER = 20 * 60;

interface Sample {
  hits: number;
  lateHits: number;
  lateTicks: number;
  minHpLate: number;
}

function play(seed: number): { world: World; sample: Sample } {
  const sample: Sample = { hits: 0, lateHits: 0, lateTicks: 0, minHpLate: Infinity };
  // Annotated: `CONFIG` is `as const`, so this would infer the literal 100.
  let lastHp: number = CONFIG.player.maxHp;

  const world = runBot(seed, CAP, (w) => {
    const hp = w.player.hp;
    // The player loses health only to a contact hit, so a drop between ticks is
    // exactly one hit — no need to reach into the damage system to count them.
    if (hp < lastHp) {
      sample.hits++;
      if (w.time >= LATE_AFTER) sample.lateHits++;
    }
    lastHp = hp;

    if (w.time >= LATE_AFTER) {
      sample.lateTicks++;
      if (hp < sample.minHpLate) sample.minHpLate = hp;
    }
  });

  return { world, sample };
}

it('plays a long run on every seed', () => {
  const rows: string[] = ['seed      time   outcome  bosses   level     kills   hits  hits/min  minHP'];

  let ended = 0;
  let reachedLate = 0;

  for (const seed of SEEDS) {
    const { world, sample } = play(seed);
    const alive = world.phase !== 'dead';
    if (!alive) ended++;

    const lateMinutes = sample.lateTicks / CONFIG.tickRate / 60;
    if (lateMinutes > 0) reachedLate++;

    rows.push(
      [
        String(seed).padEnd(9),
        `${world.time.toFixed(0)}s`.padStart(5),
        (alive ? 'alive' : 'died').padStart(9),
        String(world.bossesKilled).padStart(8),
        String(world.player.level).padStart(8),
        String(world.kills).padStart(10),
        String(sample.hits).padStart(7),
        (lateMinutes > 0 ? (sample.lateHits / lateMinutes).toFixed(1) : '-').padStart(10),
        (lateMinutes > 0 ? sample.minHpLate.toFixed(0) : '-').padStart(7),
      ].join(''),
    );
  }

  rows.push('');
  rows.push(
    `ended before the cap: ${ended}/${SEEDS.length}   ` +
      `reached minute ${LATE_AFTER / 60}: ${reachedLate}/${SEEDS.length}`,
  );
  console.log('\n' + rows.join('\n') + '\n');

  // Guard rails, and deliberately loose ones: this stand exists to be read, not
  // to gate a commit. A bot that never reaches the late game measures nothing,
  // and one that never dies anywhere measures nothing either.
  expect(reachedLate).toBeGreaterThan(0);
  expect(ended).toBeGreaterThan(0);
});
