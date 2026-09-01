/**
 * Where to draw a pointer to something that is not on screen.
 *
 * The world has no map, no minimap and no landmarks — it is an unbounded plane
 * with the camera locked to the player — so anything placed out of view is not
 * hidden, it is missing. A chest without this is content nobody can look for,
 * because there is nothing to look at and no direction to guess from.
 *
 * Pure geometry, free of the DOM, so the clamping can be tested in Node the
 * way `viewToWorld` is. The camera never rotates and its zoom is uniform, so a
 * direction in world units is the same direction in screen pixels and the HUD
 * needs nothing from the renderer to place this.
 */
/**
 * How far the marker may travel from the middle of the view, per side.
 *
 * Four numbers rather than two half-extents because the region it may be drawn
 * in is not centred on the player: the HUD owns the top strip of the glass, and
 * a marker clamped to a centred rectangle lands on the health bar. Distances
 * from the centre, all positive.
 */
export interface ViewBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface EdgeMark {
  /** Offset from the centre of the view, in pixels. */
  readonly x: number;
  readonly y: number;
  /** Which way the target lies, in radians, with 0 pointing right. */
  readonly angle: number;
  /** True when the target is inside the view and needs no pointer at all. */
  readonly onScreen: boolean;
}

/**
 * Clamps an offset to the border of the region the marker may be drawn in.
 *
 * The scale is the smaller of the two ratios that would put the point on an
 * edge, which is the one that lands on the nearer side — the other would
 * overshoot past a corner. A zero component divides to `Infinity` and loses
 * the comparison, which is exactly right: something directly above needs only
 * the horizontal edge.
 */
export function edgeMark(dx: number, dy: number, bounds: ViewBounds): EdgeMark {
  const angle = Math.atan2(dy, dx);

  const horizontal = dx >= 0 ? bounds.right : bounds.left;
  const vertical = dy >= 0 ? bounds.bottom : bounds.top;

  if (Math.abs(dx) <= horizontal && Math.abs(dy) <= vertical) {
    return { x: dx, y: dy, angle, onScreen: true };
  }

  const scale = Math.min(horizontal / Math.abs(dx), vertical / Math.abs(dy));
  return { x: dx * scale, y: dy * scale, angle, onScreen: false };
}
