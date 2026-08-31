/**
 * Thumb-stick geometry.
 *
 * Free of the DOM on purpose, the same way the simulation is: this is the part
 * with rules — a dead zone, a clamp, a direction — and rules are worth testing
 * in Node rather than by dragging a finger across a phone.
 */

/** Distance from where the finger landed at which the stick reads fully pushed. */
export const STICK_RADIUS = 56;

/**
 * Slack around the origin. A finger never lands and then holds perfectly still,
 * and without this a tap meant to do nothing would nudge the player into the
 * horde.
 */
export const STICK_DEAD_ZONE = 8;

export interface Vector {
  readonly x: number;
  readonly y: number;
}

const STILL: Vector = { x: 0, y: 0 };

/**
 * Movement intent for a finger `dx`/`dy` from where it landed.
 *
 * Analog, unlike the keyboard: a thumb that has to commit to full speed before
 * it moves at all cannot make the small corrections this genre is played with.
 * Magnitude is clamped to 1, so no touch outruns a key — the simulation
 * multiplies this by `moveSpeed` and would happily accept 3.
 */
export function stickIntent(dx: number, dy: number): Vector {
  const distance = Math.hypot(dx, dy);
  if (distance <= STICK_DEAD_ZONE) return STILL;

  const travel = Math.min(distance, STICK_RADIUS) - STICK_DEAD_ZONE;
  const magnitude = travel / (STICK_RADIUS - STICK_DEAD_ZONE);

  return { x: (dx / distance) * magnitude, y: (dy / distance) * magnitude };
}

/**
 * Where to draw the knob: under the finger, but never further out than the ring.
 *
 * Drawn from the same numbers the intent is computed from, for the same reason
 * the renderer asks the weapon helpers where a blade is — a stick that shows
 * one thing and reports another is unplayable in a way that is very hard to
 * diagnose from a bug report.
 */
export function stickKnob(dx: number, dy: number): Vector {
  const distance = Math.hypot(dx, dy);
  if (distance <= STICK_RADIUS) return { x: dx, y: dy };

  const scale = STICK_RADIUS / distance;
  return { x: dx * scale, y: dy * scale };
}
