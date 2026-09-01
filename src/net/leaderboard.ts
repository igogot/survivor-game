import { BOARD_SIZE, cleanName, faultInScore, rankScores } from '../core/scores';
import type { Score } from '../core/scores';

/**
 * The board, as the rest of the game sees it.
 *
 * An interface rather than a function, so the UI never learns that there is a
 * PHP script on a shared host at the other end. The same screens work against
 * a stub in a test, and if the board ever moves to somewhere else only this
 * file changes.
 */
export interface Leaderboard {
  /** The top hundred, best first. Empty when the board cannot be reached. */
  read(): Promise<BoardResult>;
  /** Sends a run. Returns where it landed, or why it was refused. */
  submit(score: Score): Promise<SubmitResult>;
}

export interface BoardResult {
  readonly board: readonly Score[];
  /** False when the board could not be reached at all. */
  readonly reachable: boolean;
}

export type SubmitResult =
  | { readonly ok: true; readonly board: readonly Score[]; readonly rank: number }
  | { readonly ok: false; readonly reason: SubmitFailure };

/**
 * Why a submission did not land.
 *
 * `offline` and `refused` are deliberately different words. The first is the
 * board's fault and worth retrying; the second means the run itself was not
 * believed, and retrying it will fail the same way forever.
 */
export type SubmitFailure = 'offline' | 'refused' | 'too-many' | 'invalid';

/**
 * Where the API lives.
 *
 * Relative by default, which is right on the host that serves both the game
 * and the endpoint. The game is also published to GitHub Pages, which is
 * static and has no PHP at all — that build needs `VITE_LEADERBOARD_URL` set
 * to the absolute URL of the other host, and without it the board is simply
 * unreachable and every screen says so. Unreachable is a state this feature
 * has to handle anyway, so it is not a special case.
 */
const ENDPOINT = import.meta.env.VITE_LEADERBOARD_URL ?? 'api/scores.php';

/** How long to wait before deciding the board is not going to answer. */
const TIMEOUT_MS = 6000;

export class HttpLeaderboard implements Leaderboard {
  constructor(private readonly endpoint: string = ENDPOINT) {}

  async read(): Promise<BoardResult> {
    try {
      const response = await this.request({ method: 'GET' });
      if (!response.ok) return UNREACHABLE;

      const body: unknown = await response.json();
      return { board: parseBoard(body), reachable: true };
    } catch {
      // Offline, blocked, timed out, CORS — all the same to a player looking
      // at a run they just finished, and none of them is worth a stack trace.
      return UNREACHABLE;
    }
  }

  async submit(score: Score): Promise<SubmitResult> {
    // Checked here as well as on the server, so an impossible run never leaves
    // the machine: the player finds out immediately instead of after a round
    // trip, and the board is spared the write.
    if (faultInScore(score) !== null) return { ok: false, reason: 'invalid' };

    try {
      const response = await this.request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(score),
      });

      if (response.status === 429) return { ok: false, reason: 'too-many' };
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, reason: 'refused' };
      }
      if (!response.ok) return { ok: false, reason: 'offline' };

      const body = (await response.json()) as { rank?: unknown };
      return {
        ok: true,
        board: parseBoard(body),
        rank: typeof body.rank === 'number' ? body.rank : -1,
      };
    } catch {
      return { ok: false, reason: 'offline' };
    }
  }

  /**
   * One fetch, with a deadline.
   *
   * A shared host that has gone away answers by never answering, and a result
   * screen waiting forever on a leaderboard is a result screen that looks
   * frozen. The run is already over by then, so there is nothing to protect
   * except the player's patience.
   */
  private request(init: RequestInit): Promise<Response> {
    return fetch(this.endpoint, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
}

const UNREACHABLE: BoardResult = { board: [], reachable: false };

/**
 * Turns whatever the endpoint said into scores, dropping anything that is not
 * one.
 *
 * The board is public and its contents arrive over the network, so this treats
 * the response as untrusted input rather than as its own data: a row with a
 * missing field or a name full of control characters is skipped, and one bad
 * row never costs the other ninety-nine.
 */
export function parseBoard(body: unknown): readonly Score[] {
  if (typeof body !== 'object' || body === null) return [];

  const rows = (body as { board?: unknown }).board;
  if (!Array.isArray(rows)) return [];

  const scores: Score[] = [];
  for (const row of rows) {
    const score = parseScore(row);
    if (score !== null) scores.push(score);
  }

  // Ranked again on arrival rather than trusted to be in order. The server
  // sorts by the same rule, so this normally changes nothing — but it is the
  // one line that guarantees the board on screen is in the order this game
  // says it should be in.
  return rankScores(scores, BOARD_SIZE);
}

function parseScore(row: unknown): Score | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = row as Record<string, unknown>;

  const name = typeof value.name === 'string' ? cleanName(value.name) : null;
  if (name === null) return null;

  const score: Score = {
    name,
    timeMs: whole(value.timeMs),
    kills: whole(value.kills),
    level: whole(value.level),
    bosses: whole(value.bosses),
    weapon: typeof value.weapon === 'string' ? value.weapon : '',
    seed: whole(value.seed),
  };

  return faultInScore(score) === null ? score : null;
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : -1;
}
