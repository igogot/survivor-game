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
 *
 * What it no longer is, and this is worth being plain about, is a window onto
 * something `npm run balance` cannot see. It was that when a run reached minute
 * ninety and the balance stand watched twelve. Runs now end inside fourteen, so
 * the two overlap almost entirely and the only thing this still holds alone is
 * the pair of columns balance does not print: how often a player is hit, and how
 * low they got. Those are worth a stand. A separate forty-minute window is worth
 * rather less than it was, and the day a run stops reaching minute ten is the day
 * to fold this into `balance` rather than lower the bar again.
 */
const SEEDS = [42, 1337, 99, 7, 11, 2024, 5, 808];

/** Forty minutes. Long enough for three or four bosses on a run that lives. */
const CAP = 2400;

/**
 * Minute after which a run counts as "late" for the hit-rate column.
 *
 * Twenty when this stand was written, because a bot left alone then reached
 * minute ninety and one seed in five saw minute forty-six. It reached zero
 * seeds some time ago and nobody noticed, because this stand is not in
 * `npm test` — which is the failure mode a guard is supposed to prevent and did
 * not, since a red stand nobody runs is the same as no stand.
 *
 * Ten now, and set from the measurement rather than from a wish: runs end
 * between minute seven and minute fourteen, so six seeds of eight pass this and
 * two do not. That is a column with something in it and a guard with room, and
 * both of those were the point.
 *
 * The forty-minute cap above stays. It costs nothing while runs end at fourteen
 * — the loop stops at the last death — and it is the thing that would notice
 * the game getting long again.
 */
const LATE_AFTER = 10 * 60;

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
    const hp = w.players[0].hp;
    // A drop between ticks is exactly one hit — nothing else takes health, and
    // the one thing that gives it back only ever moves this the other way — so
    // there is no need to reach into the damage system to count them.
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
        String(world.level).padStart(8),
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

  // Guard rails: this stand exists to be read, and a stand that cannot measure
  // has to say so rather than print an empty column.
  //
  // Three rather than one, which is the lesson of how this last went red. The
  // README said a year of this ago that the guard was down to a single seed and
  // that the next run-shortening change would fail it — and then the change came
  // and it did, quietly, because one seed was never enough to average a hit rate
  // over anyway. A threshold that only fails after the measurement is already
  // worthless is a threshold set too low.
  expect(reachedLate, 'nobody reaches the late game; this stand measures nothing').toBeGreaterThanOrEqual(3);
  expect(ended, 'nobody dies; this stand measures nothing either').toBeGreaterThan(0);
});
