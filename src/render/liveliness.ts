/**
 * What keeps a body from looking like a photograph being dragged around.
 *
 * The sheet has one frame per creature and no walk cycles, so the motion here
 * is applied to that single frame rather than cut from extra art: a bounce, a
 * waddle, a squash on landing, and a slow breath for anything standing still.
 * Four cheap functions of the clock, and between them a crab that scuttles and
 * a slime that wobbles instead of two stickers sliding across the floor.
 *
 * Nothing rotates. Every term below either moves the frame along an axis or
 * scales it along one, which leaves the pixel grid aligned to the screen — the
 * same reason the burning ground turns in quarters and never by a free angle.
 * A body tilted three degrees is a body whose pixels have become a gradient,
 * and at this scale that reads as blur rather than as a lean.
 *
 * Derived, never stored. The renderer is a pure read of world state, and an
 * animation clock on the entities would be a second source of truth that the
 * simulation would have to advance, the snapshot would have to carry over the
 * wire, and the balance runs would have to keep in step for no gain at all.
 * Everything here comes out of numbers the world already holds: the run clock,
 * the entity's id, and the ground it covered during the last tick.
 */

import { CONFIG } from '../config';
import { TAU } from '../core/math';

/**
 * How the frame should be shifted and stretched this instant.
 *
 * Offsets are in world units and go on top of the interpolated position; the
 * scales multiply whatever size the body is drawn at.
 */
export interface BodyMotion {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Bounce cycles per second at a full run.
 *
 * One cycle is two footfalls, so this is a little over three steps a second —
 * quick enough to read as scurrying at the size these things are drawn, slow
 * enough that a single bounce lasts several frames at sixty hertz instead of
 * turning into a vibration.
 */
const STRIDE_HZ = 1.7;

/** Height of the bounce at a full run, as a fraction of the body's radius. */
const HOP = 0.17;

/**
 * Sideways lean at a full run, as a fraction of the radius.
 *
 * Half the hop, and on twice its period: the body leans one way over one
 * footfall and the other way over the next, which is what makes the bounce
 * read as walking rather than as a ball being dribbled.
 */
const SWAY = 0.09;

/** How far the body squashes and stretches over one bounce, at a full run. */
const SQUASH = 0.13;

/**
 * How much of the squash the width answers with.
 *
 * Under one on purpose. Conserving area exactly is what a rubber ball does;
 * a creature with legs loses most of the height into them and spreads only a
 * little, and matching the two exactly makes the bounce look inflated.
 */
const WIDTH_ANSWER = 0.7;

/** Breaths per second for a body that is standing still. */
const BREATH_HZ = 0.55;

/** How far a breath swells the body, as a fraction of its size. */
const BREATH = 0.04;

/**
 * Spreads phases across entities so a crowd is not a chorus line.
 *
 * Ids are handed out in order, so keying the phase on the id directly would
 * make a wave travel through a group that spawned together. Multiplying by the
 * golden ratio and keeping the fraction is the cheapest way to turn a run of
 * consecutive integers into points that stay far apart at every count — the
 * same trick that spaces hues when a palette has no fixed size.
 */
const GOLDEN = 0.618_033_988_749_895;

/**
 * The bounce, waddle, squash and breath of one body this instant.
 *
 * `travelledX`/`travelledY` are the ground covered during the last tick, which
 * every entity already carries as the gap between its position and its
 * previous one. Dividing that by what the body could have covered gives a pace
 * in `0..1`, and every term scales by it: a creature held at bay by its
 * standoff drifts and barely bobs, one charging the player runs flat out, and
 * one that has stopped is left to breathe. The pace is what stops the effect
 * from being a uniform jiggle applied to everything on screen.
 */
export function bodyMotion(
  time: number,
  key: number,
  travelledX: number,
  travelledY: number,
  topSpeed: number,
  radius: number,
): BodyMotion {
  const travelled = Math.hypot(travelledX, travelledY);
  // A tick's worth of ground at full speed. Guarded because a definition with
  // no speed would otherwise divide by zero and pin the body at full stride.
  const stride = topSpeed > 0 ? topSpeed / CONFIG.tickRate : 0;
  const pace = stride > 0 ? Math.min(1, travelled / stride) : 0;
  const still = 1 - pace;

  const phase = (time * STRIDE_HZ + key * GOLDEN) * TAU;
  // `|sin|` for the hop and plain `sin` for the lean: the first repeats twice
  // per cycle and the second once, which is exactly the relationship between
  // footfalls and which side the weight is on.
  const hop = Math.abs(Math.sin(phase));
  const sway = Math.sin(phase);

  // -1 with both feet down, +1 at the top of the bounce. Squashed on the
  // ground and stretched in the air, which is the whole read on the weight of
  // the thing.
  const stretch = (hop * 2 - 1) * SQUASH * pace;
  const breath = Math.sin((time * BREATH_HZ + key * GOLDEN) * TAU) * BREATH * still;

  const scaleY = 1 + stretch + breath;
  const scaleX = 1 - stretch * WIDTH_ANSWER - breath * WIDTH_ANSWER;

  return {
    offsetX: sway * SWAY * radius * pace,
    // Two separate reasons to move on this axis. The first is the bounce
    // itself, upwards, which is negative here. The second keeps the feet on
    // the floor: a frame is anchored at its middle, so squashing it by a tenth
    // would otherwise lift its lower edge by a twentieth of the body and the
    // creature would hover exactly when it is meant to be landing.
    offsetY: -hop * HOP * radius * pace + radius * (1 - scaleY),
    scaleX,
    scaleY,
  };
}
