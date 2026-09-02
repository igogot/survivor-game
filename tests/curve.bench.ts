import { it } from 'vitest';
import { CONFIG } from '../src/config';
import { enemyCeiling, spawnBatch, spawnInterval } from '../src/systems/spawn';
import { runBot } from './bot';
import type { World } from '../src/world/world';

/**
 * A probe, not a stand.
 *
 * `npm run balance` answers "did the run go better or worse". It cannot answer
 * "where in the run", and every question about tempo is a question about where:
 * a curve that is flat for four minutes and then vertical produces the same
 * average as one that rises steadily, and they are completely different games.
 *
 * So this prints what the horde is doing minute by minute — how many bodies are
 * alive, how close that is to the ceiling, how many arrivals the curve is
 * asking for, and what health they carry. It asserts nothing. Nothing here can
 * fail; it is for reading before choosing a constant, so that the constant is
 * chosen against the part of the run that actually binds.
 *
 * The first thing it said, and the reason it exists: the game is thin at the
 * start rather than soft at the end. Two minutes in, a tenth of the ceiling is
 * occupied; the cap only binds around minute twelve, and only for the runs that
 * live that long.
 */

const SEEDS = [42, 1337, 99, 7, 11, 2024, 5, 808];

/** Fifteen minutes: past the point where runs end, so the tail is visible. */
const CAP = 900;

const STEP = 60;

interface Row {
  minute: number;
  /** How many of the seeds were still alive to be sampled at this minute. */
  samples: number;
  alive: number;
  ceiling: number;
  arrivals: number;
  hp: number;
}

it('prints what the horde is doing every minute', () => {
  const rows = new Map<number, Row>();

  for (const seed of SEEDS) {
    let nextAt = 0;

    runBot(seed, CAP, (world: World) => {
      if (world.time < nextAt) return;
      nextAt = world.time + STEP;

      const minute = Math.round(world.time / 60);
      const row = rows.get(minute) ?? {
        minute,
        samples: 0,
        alive: 0,
        ceiling: 0,
        arrivals: 0,
        hp: 0,
      };

      row.samples++;
      row.alive += world.enemies.length;
      row.ceiling += enemyCeiling(world);
      row.arrivals += spawnBatch(world) / spawnInterval(world);
      row.hp += 1 + (world.time / 60) * CONFIG.spawn.hpScalePerMinute;
      rows.set(minute, row);
    });
  }

  const lines = ['min  runs  alive   ceil   %cap   arrivals/s   hpx'];
  for (const row of [...rows.values()].sort((a, b) => a.minute - b.minute)) {
    const alive = row.alive / row.samples;
    const ceiling = row.ceiling / row.samples;
    lines.push(
      [
        String(row.minute).padStart(3),
        String(row.samples).padStart(5),
        alive.toFixed(0).padStart(6),
        ceiling.toFixed(0).padStart(6),
        `${((alive / ceiling) * 100).toFixed(0)}%`.padStart(6),
        (row.arrivals / row.samples).toFixed(1).padStart(12),
        (row.hp / row.samples).toFixed(1).padStart(6),
      ].join(''),
    );
  }

  // `arrivals/s` is read at one instant a minute and `waveIntensity` pulses, so
  // a single row can land in a trough and read low. Trends across rows mean
  // something; one row against its neighbour does not.
  console.log(`\n${lines.join('\n')}\n`);
});
