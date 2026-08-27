/**
 * Slack added to every broad-phase query radius.
 *
 * The grid is built right after movement, but the separation pass then shifts
 * enemies by a few pixels. Rather than rebuild the grid twice per tick, queries
 * ask for slightly more than they need — a handful of extra candidates that the
 * exact distance check discards anyway.
 */
export const BROADPHASE_PAD = 8;
