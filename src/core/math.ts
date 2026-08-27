export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Squared distance. Collision loops run thousands of times per tick, and a
 * comparison against a squared radius avoids the sqrt entirely.
 */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** A full turn in radians. Orbiting weapons space themselves evenly around it. */
export const TAU = Math.PI * 2;
