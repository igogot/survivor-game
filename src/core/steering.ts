/**
 * Walking to a point that was clicked.
 *
 * Free of the DOM and of the world, like the stick geometry next to it: the
 * rule here is only "head that way, and stop when you get there", and a rule is
 * worth testing in Node rather than by aiming a mouse at a canvas.
 */

/** One tick of walking toward a destination. */
export interface Approach {
  /** Movement intent, magnitude 0..1. */
  readonly x: number;
  readonly y: number;
  /** True once the destination is reached and the order should be dropped. */
  readonly arrived: boolean;
}

const STOPPED: Approach = { x: 0, y: 0, arrived: true };

/**
 * Intent that walks from `x`/`y` toward the destination without passing it.
 *
 * `step` is how far one tick of movement covers. Anything closer than that gets
 * a partial intent that lands exactly on the point: at full strength the player
 * would overshoot, turn round next tick, overshoot again, and vibrate on the
 * spot instead of arriving. That is also why arrival is reported rather than
 * left to a proximity test by the caller — the two have to agree, or the order
 * survives the tick that fulfilled it.
 */
export function approach(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  step: number,
): Approach {
  // A player who cannot move is never going to get any closer, and an order
  // nothing can ever fulfil would leave a mark on the ground forever.
  if (step <= 0) return STOPPED;

  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.hypot(dx, dy);

  if (distance <= step) return { x: dx / step, y: dy / step, arrived: true };

  return { x: dx / distance, y: dy / distance, arrived: false };
}

/**
 * Where on the ground a point on the canvas is.
 *
 * The camera is a translation and a scale, so this is its inverse and nothing
 * else — but it is the one step of the click path that playing the game cannot
 * check: an order placed a little off looks exactly like a mouse aimed a little
 * off, and neither the marker nor the walk would look wrong.
 *
 * `viewX`/`viewY` are relative to the canvas, and `cameraX`/`cameraY` are the
 * camera's position in that same space.
 */
export function viewToWorld(
  viewX: number,
  viewY: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: (viewX - cameraX) / zoom, y: (viewY - cameraY) / zoom };
}
