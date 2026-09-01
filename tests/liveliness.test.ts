import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { bodyMotion } from '../src/render/liveliness';

const RADIUS = 10;
const TOP_SPEED = 120;
/** A tick's worth of ground at a flat run, which is what pace 1 means. */
const FULL_STRIDE = TOP_SPEED / CONFIG.tickRate;

/** Where the lower edge of the frame sits, relative to the body's centre. */
function footing(motion: { offsetY: number; scaleY: number }): number {
  return motion.offsetY + RADIUS * motion.scaleY;
}

function sample(time: number, travelled: number, key = 3) {
  return bodyMotion(time, key, travelled, 0, TOP_SPEED, RADIUS);
}

describe('bodyMotion', () => {
  /**
   * The property the whole thing is built around. A frame is anchored at its
   * middle, so squashing it lifts its lower edge — and a creature that rises
   * off the floor exactly when it is meant to be landing reads as hovering
   * rather than as weight. Everything else here is decoration; this is the
   * part that makes the bounce look like it touches the ground.
   */
  it('keeps a still body planted no matter where in the breath it is caught', () => {
    for (let i = 0; i < 400; i++) {
      const motion = sample(i * 0.037, 0);
      expect(footing(motion)).toBeCloseTo(RADIUS, 9);
    }
  });

  /** Airborne is allowed; sunk into the floor is not. */
  it('never puts a running body below the floor', () => {
    for (let i = 0; i < 400; i++) {
      expect(footing(sample(i * 0.037, FULL_STRIDE))).toBeLessThanOrEqual(RADIUS + 1e-9);
    }
  });

  it('leaves a body that has not moved without a bounce or a lean', () => {
    for (let i = 0; i < 50; i++) {
      const motion = sample(i * 0.11, 0);
      // `toBeCloseTo` rather than `toBe`: the lean is a sine times a pace of
      // zero, and half the cycle multiplies out to negative zero.
      expect(motion.offsetX).toBeCloseTo(0, 12);
      // Only the breath is left, and a breath is a fraction of a body.
      expect(Math.abs(motion.offsetY)).toBeLessThan(RADIUS * 0.1);
    }
  });

  /**
   * Pace is what stops this from being one jiggle applied to everything on
   * screen: a caster holding its distance should barely stir next to a runner
   * closing in.
   */
  it('bounces a running body further than a drifting one', () => {
    const swing = (travelled: number): number => {
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < 200; i++) {
        const y = sample(i * 0.017, travelled).offsetY;
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
      return high - low;
    };

    expect(swing(FULL_STRIDE)).toBeGreaterThan(swing(FULL_STRIDE * 0.25) * 2);
  });

  /** Faster than the definition allows still means a full run, not a longer one. */
  it('clamps pace so a shove cannot fling the frame', () => {
    const running = sample(1.3, FULL_STRIDE);
    const shoved = sample(1.3, FULL_STRIDE * 40);

    expect(shoved.offsetY).toBeCloseTo(running.offsetY, 9);
    expect(shoved.offsetX).toBeCloseTo(running.offsetX, 9);
  });

  /**
   * A pack spawns together and is handed consecutive ids. Keying the phase on
   * the id directly would send a wave through them; the point of spreading the
   * keys is that neighbours in the list are not neighbours in the cycle.
   */
  it('puts consecutive ids out of step with each other', () => {
    const heights = [0, 1, 2, 3, 4].map(
      (id) => bodyMotion(2.5, id, FULL_STRIDE, 0, TOP_SPEED, RADIUS).offsetY,
    );

    for (let i = 1; i < heights.length; i++) {
      expect(Math.abs(heights[i] - heights[i - 1])).toBeGreaterThan(RADIUS * 0.02);
    }
  });

  /**
   * A definition with no speed is a body that cannot walk, not a body at a
   * full sprint — and never a division that reaches the scale of a sprite.
   */
  it('survives a body with no speed of its own', () => {
    const motion = bodyMotion(4.2, 7, 0, 0, 0, RADIUS);

    expect(Number.isFinite(motion.offsetX)).toBe(true);
    expect(Number.isFinite(motion.offsetY)).toBe(true);
    expect(motion.scaleX).toBeGreaterThan(0);
    expect(motion.scaleY).toBeGreaterThan(0);
  });

  it('never turns a frame inside out', () => {
    for (let i = 0; i < 300; i++) {
      const motion = sample(i * 0.023, FULL_STRIDE);
      expect(motion.scaleX).toBeGreaterThan(0.5);
      expect(motion.scaleY).toBeGreaterThan(0.5);
      expect(motion.scaleX).toBeLessThan(1.5);
      expect(motion.scaleY).toBeLessThan(1.5);
    }
  });
});
