import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { parseBoard } from '../src/net/leaderboard';
import { BOARD_SIZE } from '../src/core/scores';

/**
 * The board arrives over the network from a table anybody can write to, so it
 * is treated as untrusted input rather than as this game's own data. These
 * tests are about the failure that matters: one bad row must never cost the
 * other ninety-nine, and nothing that could not have happened may be displayed
 * as though it did.
 */

/**
 * A row that describes a run the game could actually have produced.
 *
 * `bosses` is derived rather than fixed, because the boss bound is exact: a
 * run shorter than one interval cannot have felled one, and a fixture that
 * ignores that is refused by the very check these tests exist to exercise.
 * Writing invalid fixtures and then loosening the validator to accept them is
 * the mistake this comment is here to prevent.
 */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  const timeMs = typeof over.timeMs === 'number' ? over.timeMs : 600_000;
  const seconds = Math.max(0, timeMs / 1000);

  return {
    name: 'player',
    timeMs,
    // Eight kills a second and a level every twenty is roughly what the stand
    // measures. Anything flatter — a fixed 5000 kills on a ten-second run —
    // describes a game that does not exist and is refused, correctly, by the
    // checks these tests are here to exercise.
    kills: Math.floor(seconds * 8),
    level: 1 + Math.floor(seconds / 40),
    bosses: Math.floor(seconds / CONFIG.boss.interval),
    weapon: 'bolt',
    seed: 42,
    party: 1,
    ...over,
  };
}

describe('parseBoard', () => {
  it('reads an ordinary board', () => {
    const board = parseBoard({ board: [row({ name: 'a' }), row({ name: 'b', timeMs: 900_000 })] });
    expect(board.map((entry) => entry.name)).toEqual(['b', 'a']);
  });

  it('survives a response that is not a board at all', () => {
    expect(parseBoard(null)).toEqual([]);
    expect(parseBoard('nope')).toEqual([]);
    expect(parseBoard({})).toEqual([]);
    expect(parseBoard({ board: 'nope' })).toEqual([]);
    expect(parseBoard({ board: [null, 7, 'x'] })).toEqual([]);
  });

  /** One row missing a field must not empty the screen. */
  it('drops a bad row and keeps the rest', () => {
    const board = parseBoard({
      board: [row({ name: 'good' }), { name: 'broken' }, row({ name: 'also-good' })],
    });
    expect(board.map((entry) => entry.name).sort()).toEqual(['also-good', 'good']);
  });

  /**
   * The server checks these too, but a board is only as trustworthy as the
   * last thing that wrote to it — a row inserted by hand, or left over from an
   * older set of rules, is refused here as well.
   */
  it('refuses a row the game could not have produced', () => {
    const impossible = [
      row({ name: 'time', timeMs: -1, bosses: 0 }),
      row({ name: 'kills', kills: 99_999_999 }),
      row({ name: 'kills-for-the-time', timeMs: 10_000, kills: 40_000 }),
      row({ name: 'bosses', timeMs: 60_000, bosses: 5 }),
      row({ name: 'level', kills: 0, level: 60, bosses: 0 }),
      row({ name: 'shape', timeMs: 1.5, bosses: 0 }),
    ];

    expect(parseBoard({ board: impossible })).toEqual([]);
  });

  it('refuses a row whose name is nothing once cleaned', () => {
    expect(parseBoard({ board: [row({ name: '   ' })] })).toEqual([]);
  });

  /**
   * A name carrying a bidi override would reorder the rows around it on
   * screen. It is cleaned on the way in rather than the row being thrown away:
   * the danger is the character reaching the DOM, and dropping somebody's
   * entry over a stray byte punishes the wrong person.
   */
  it('cleans a name that arrives with an override in it', () => {
    const sneaky = `bad${String.fromCodePoint(0x202e)}name`;
    const board = parseBoard({ board: [row({ name: sneaky })] });

    expect(board).toHaveLength(1);
    expect(board[0].name).toBe('badname');
  });

  it('never returns more than the board holds', () => {
    const many = Array.from({ length: BOARD_SIZE * 2 }, (_, i) =>
      row({ name: `p${i}`, timeMs: 10_000 + i }),
    );
    expect(parseBoard({ board: many })).toHaveLength(BOARD_SIZE);
  });

  /** Ranked on arrival, so a server that answered out of order cannot mislead. */
  it('puts the board in order whatever order it came in', () => {
    const board = parseBoard({
      board: [
        row({ name: 'middle', timeMs: 500_000 }),
        row({ name: 'best', timeMs: 900_000 }),
        row({ name: 'worst', timeMs: 100_000 }),
      ],
    });

    expect(board.map((entry) => entry.name)).toEqual(['best', 'middle', 'worst']);
  });

  it('keeps one row per name even if the server sent two', () => {
    const board = parseBoard({
      board: [row({ name: 'ann', timeMs: 100_000 }), row({ name: 'Ann', timeMs: 800_000 })],
    });

    expect(board).toHaveLength(1);
    expect(board[0].timeMs).toBe(800_000);
  });
});

describe('keeping the boards apart', () => {
  /**
   * A party row on the solo table would be a record nobody could match, and a
   * solo row on the party table would be one anybody could. Whichever way a
   * stray row arrives, the screen it lands on refuses it.
   */
  it('drops party rows from the solo board', () => {
    const mixed = { board: [row({ name: 'solo' }), row({ name: 'four', party: 4 })] };
    expect(parseBoard(mixed, 'solo').map((entry) => entry.name)).toEqual(['solo']);
  });

  it('drops solo rows from the party board', () => {
    const mixed = { board: [row({ name: 'solo' }), row({ name: 'four', party: 4 })] };
    expect(parseBoard(mixed, 'party').map((entry) => entry.name)).toEqual(['four']);
  });

  it('cuts the party board at fifty', () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      row({ name: `p${i}`, timeMs: 10_000 + i, party: 3 }),
    );
    expect(parseBoard({ board: many }, 'party')).toHaveLength(50);
  });

  /** Rows written before parties existed carry no size, and all of them were solo. */
  it('reads a row from before parties as a solo run', () => {
    const old = row();
    delete (old as Record<string, unknown>).party;

    const board = parseBoard({ board: [old] }, 'solo');
    expect(board).toHaveLength(1);
    expect(board[0].party).toBe(1);
  });
});
