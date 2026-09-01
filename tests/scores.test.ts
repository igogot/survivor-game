import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  BOARD_SIZE,
  MAX_NAME_LENGTH,
  MAX_RUN_MS,
  bossCeiling,
  cleanName,
  compareScores,
  faultInScore,
  killCeiling,
  levelCeiling,
  rankOf,
  rankScores,
} from '../src/core/scores';
import { runBot } from './bot';
import type { Score } from '../src/core/scores';

/**
 * The board's two jobs, tested separately.
 *
 * Ranking has to be a total order that agrees with what the game says the
 * score is. The bounds have to refuse impossible runs — and, far more
 * importantly, never refuse a real one. The second half of that is what the
 * bot is for: a bound that rejects an actual run is worse than no bound,
 * because it turns the leaderboard into a thing that punishes playing well.
 */

function score(over: Partial<Score> = {}): Score {
  return {
    name: 'player',
    timeMs: 600_000,
    kills: 5000,
    level: 25,
    bosses: 1,
    weapon: 'bolt',
    seed: 42,
    ...over,
  };
}

describe('ranking', () => {
  it('ranks by time survived, which is what the game calls the score', () => {
    const slow = score({ name: 'a', timeMs: 100_000, kills: 99_999, bosses: 0 });
    const fast = score({ name: 'b', timeMs: 200_000, kills: 1, bosses: 0 });
    expect(rankScores([slow, fast]).map((entry) => entry.name)).toEqual(['b', 'a']);
  });

  it('breaks a tie on bosses before kills', () => {
    const boss = score({ name: 'a', bosses: 2, kills: 1 });
    const grind = score({ name: 'b', bosses: 1, kills: 9999 });
    expect(rankScores([boss, grind]).map((entry) => entry.name)).toEqual(['a', 'b']);
  });

  it('is a total order — sorting twice changes nothing', () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      score({ name: `p${i}`, timeMs: (i % 7) * 1000, bosses: i % 3, kills: i % 5 }),
    );
    const once = rankScores(entries);
    expect(rankScores(once)).toEqual(once);
    expect([...once].sort(compareScores)).toEqual(once);
  });

  /**
   * One row per name, the way an arcade cabinet does it. Without this the
   * player with the most free time owns every row and the board stops being
   * about the runs.
   */
  it('keeps only each name’s best run', () => {
    const board = rankScores([
      score({ name: 'ann', timeMs: 100 }),
      score({ name: 'ann', timeMs: 900 }),
      score({ name: 'ann', timeMs: 400 }),
      score({ name: 'bob', timeMs: 500 }),
    ]);

    expect(board).toHaveLength(2);
    expect(board[0]).toMatchObject({ name: 'ann', timeMs: 900 });
  });

  it('treats a name as the same name whatever its case', () => {
    const board = rankScores([
      score({ name: 'Ann', timeMs: 100 }),
      score({ name: 'ANN', timeMs: 900 }),
    ]);
    expect(board).toHaveLength(1);
  });

  it('never returns more than the board holds', () => {
    const crowd = Array.from({ length: BOARD_SIZE * 3 }, (_, i) =>
      score({ name: `p${i}`, timeMs: i * 1000 }),
    );
    expect(rankScores(crowd)).toHaveLength(BOARD_SIZE);
  });

  it('reports where a run would land, and that it would not', () => {
    const board = rankScores(
      Array.from({ length: BOARD_SIZE }, (_, i) => score({ name: `p${i}`, timeMs: 10_000 + i })),
    );

    expect(rankOf(score({ name: 'new', timeMs: 999_999 }), board)).toBe(0);
    expect(rankOf(score({ name: 'new', timeMs: 1 }), board)).toBe(-1);
  });
});

describe('names', () => {
  it('trims and caps', () => {
    expect(cleanName('  spaced  ')).toBe('spaced');
    expect(cleanName('x'.repeat(200))?.length).toBe(MAX_NAME_LENGTH);
  });

  it('refuses a name that is nothing at all', () => {
    expect(cleanName('')).toBeNull();
    expect(cleanName('   ')).toBeNull();
  });

  /** Pasted from anywhere, meant by nobody. Stripped rather than refused. */
  it('strips what a keyboard did not mean to send', () => {
    // Built from code points rather than pasted in: a source file holding raw
    // control characters is one an editor can silently repair, taking the test
    // with it.
    const ch = (point: number): string => String.fromCodePoint(point);

    expect(cleanName(`a${ch(0x07)}bc`)).toBe('abc');
    expect(cleanName(`we${ch(0x200b)}ird`)).toBe('weird');
    expect(cleanName(`two${ch(0x0a)}lines`)).toBe('twolines');
    expect(cleanName(`right${ch(0x202e)}left`)).toBe('rightleft');
  });

  it('leaves ordinary writing alone, in any script', () => {
    expect(cleanName('Игрок')).toBe('Игрок');
    expect(cleanName('ka-50 🐙')).toBe('ka-50 🐙');
  });

  it('is idempotent, which is what the server checks against', () => {
    for (const raw of ['  bob ', 'Игрок', 'x'.repeat(50), 'ab']) {
      const once = cleanName(raw);
      if (once === null) continue;
      expect(cleanName(once)).toBe(once);
    }
  });
});

describe('what the bounds refuse', () => {
  it('accepts an ordinary run', () => {
    expect(faultInScore(score())).toBeNull();
  });

  it('refuses a run longer than a day', () => {
    expect(faultInScore(score({ timeMs: MAX_RUN_MS + 1 }))).toBe('time');
    expect(faultInScore(score({ timeMs: -1 }))).toBe('time');
  });

  it('refuses more kills than the spawner could have delivered', () => {
    expect(faultInScore(score({ kills: 10_000_000 }))).toBe('kills');
  });

  it('refuses a level the kills could not have paid for', () => {
    expect(faultInScore(score({ kills: 0, level: 40 }))).toBe('level');
  });

  /**
   * The exact one. A boss arrives on the interval and the clock for the next
   * starts when the last one died, so this cannot be beaten by playing well.
   */
  it('refuses more bosses than the clock allows', () => {
    const oneInterval = CONFIG.boss.interval * 1000;
    expect(bossCeiling(oneInterval)).toBe(1);
    expect(faultInScore(score({ timeMs: oneInterval, bosses: 2 }))).toBe('bosses');
    expect(faultInScore(score({ timeMs: oneInterval, bosses: 1 }))).toBeNull();
  });

  it('refuses anything that is not a whole number', () => {
    expect(faultInScore(score({ timeMs: 1.5 }))).toBe('shape');
    expect(faultInScore(score({ kills: Number.NaN }))).toBe('shape');
    expect(faultInScore(score({ level: Number.POSITIVE_INFINITY }))).toBe('shape');
  });

  it('refuses a name the client should already have cleaned', () => {
    expect(faultInScore(score({ name: '  padded  ' }))).toBe('name');
    expect(faultInScore(score({ name: '' }))).toBe('name');
  });
});

describe('what the bounds must never refuse', () => {
  /**
   * The half that matters. These ceilings are guesses about the shape of the
   * game, and a guess that lands under a real run turns the board into a thing
   * that refuses the players who earned a place on it. So they are checked
   * against runs the game actually produced, not against invented numbers.
   */
  it('accepts every run the bot plays', () => {
    for (const seed of [42, 1337, 7]) {
      const world = runBot(seed, 720);
      const played: Score = {
        name: 'bot',
        timeMs: Math.round(world.time * 1000),
        kills: world.kills,
        level: world.player.level,
        bosses: world.bossesKilled,
        weapon: world.starterId,
        seed,
      };

      expect(faultInScore(played)).toBeNull();
    }
  }, 60_000);

  /** Two minutes in, a fast start must still be inside the kill ceiling. */
  it('leaves room above what the horde can actually deliver', () => {
    // The stand has never seen better than about fifteen kills a second.
    const observed = 15;
    for (const seconds of [30, 120, 600, 2400]) {
      expect(killCeiling(seconds * 1000)).toBeGreaterThan(seconds * observed);
    }
  });

  it('leaves room above the deepest run anybody has measured', () => {
    // The endless stand reached level 118 with a quarter of a million kills.
    expect(levelCeiling(250_000)).toBeGreaterThan(118);
  });

  it('never bounds a short run to nothing', () => {
    expect(killCeiling(0)).toBeGreaterThan(0);
    expect(levelCeiling(0)).toBe(1);
    expect(bossCeiling(0)).toBe(0);
  });
});
