/**
 * Escape hatches for driving the game from a harness.
 *
 * Everything here is gated on `import.meta.env.DEV` at the call site and is
 * therefore unreachable in a build a player runs, the same treatment the
 * console handle in main.ts gets.
 */

/**
 * Whether auto-pause should stay unwired.
 *
 * A browser-automation harness runs the page in a tab that is neither focused
 * nor visible, so `blur` and `visibilitychange` fire more or less continuously
 * and the run can never advance. `?nopause` lifts that, and only in a dev
 * build — the shipped game has no way to reach it.
 *
 * `isDev` is passed in rather than read here so the rule stays a pure function
 * of its inputs and both branches are testable in plain Node.
 */
export function autoPauseDisabled(search: string, isDev: boolean): boolean {
  if (!isDev) return false;
  return new URLSearchParams(search).has('nopause');
}
