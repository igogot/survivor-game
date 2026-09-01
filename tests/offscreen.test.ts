import { describe, expect, it } from 'vitest';
import { edgeMark } from '../src/ui/offscreen';

/**
 * The pointer is the only thing standing between a chest and content nobody
 * can find, so the property that matters is that it always lands somewhere
 * visible and always points the right way. Pure geometry, tested in Node — the
 * split that keeps this out of the HUD class.
 */

const HALF_W = 400;
const HALF_H = 300;

/** A region centred on the player, which is what most of these are about. */
const EVEN = { left: HALF_W, right: HALF_W, top: HALF_H, bottom: HALF_H };

/** Every point the clamp returns must sit on the border it was clamped to. */
function onBorder(x: number, y: number, bounds = EVEN): boolean {
  const horizontal = x >= 0 ? bounds.right : bounds.left;
  const vertical = y >= 0 ? bounds.bottom : bounds.top;
  const touchesSide = Math.abs(Math.abs(x) - horizontal) < 1e-9 && Math.abs(y) <= vertical + 1e-9;
  const touchesTopOrBottom =
    Math.abs(Math.abs(y) - vertical) < 1e-9 && Math.abs(x) <= horizontal + 1e-9;
  return touchesSide || touchesTopOrBottom;
}

describe('edgeMark', () => {
  it('leaves a target inside the view where it is', () => {
    const mark = edgeMark(120, -60, EVEN);
    expect(mark.onScreen).toBe(true);
    expect(mark.x).toBe(120);
    expect(mark.y).toBe(-60);
  });

  it('counts a target exactly on the border as visible', () => {
    expect(edgeMark(HALF_W, HALF_H, EVEN).onScreen).toBe(true);
  });

  it('pulls a distant target back onto the border', () => {
    const mark = edgeMark(4000, 300, EVEN);
    expect(mark.onScreen).toBe(false);
    expect(onBorder(mark.x, mark.y)).toBe(true);
  });

  /**
   * Every direction, including the diagonals where the wrong ratio would put
   * the marker past a corner and off the glass entirely.
   */
  it('never lands outside the border, whatever the direction', () => {
    for (let i = 0; i < 64; i++) {
      const angle = (i * Math.PI * 2) / 64;
      const mark = edgeMark(Math.cos(angle) * 5000, Math.sin(angle) * 5000, EVEN);

      expect(mark.onScreen).toBe(false);
      expect(Math.abs(mark.x)).toBeLessThanOrEqual(HALF_W + 1e-9);
      expect(Math.abs(mark.y)).toBeLessThanOrEqual(HALF_H + 1e-9);
      expect(onBorder(mark.x, mark.y)).toBe(true);
    }
  });

  /** The clamp moves the marker along the line, never off it. */
  it('keeps pointing at the target it was given', () => {
    for (let i = 0; i < 32; i++) {
      const angle = -Math.PI + (i * Math.PI * 2) / 32;
      const dx = Math.cos(angle) * 3000;
      const dy = Math.sin(angle) * 3000;
      const mark = edgeMark(dx, dy, EVEN);

      expect(mark.angle).toBeCloseTo(Math.atan2(dy, dx), 9);
      expect(Math.atan2(mark.y, mark.x)).toBeCloseTo(mark.angle, 9);
    }
  });

  /**
   * A zero component divides to Infinity and has to lose the comparison, or
   * something directly above the player marks at NaN and disappears.
   */
  it('handles a target on a straight axis', () => {
    const above = edgeMark(0, -2000, EVEN);
    expect(above.x).toBe(0);
    expect(above.y).toBe(-HALF_H);

    const beside = edgeMark(2000, 0, EVEN);
    expect(beside.x).toBe(HALF_W);
    expect(beside.y).toBe(0);
  });

  it('treats a target on top of the player as visible', () => {
    const mark = edgeMark(0, 0, EVEN);
    expect(mark.onScreen).toBe(true);
    expect(Number.isNaN(mark.x)).toBe(false);
    expect(Number.isNaN(mark.y)).toBe(false);
  });
});

describe('a view the player is not in the middle of', () => {
  /**
   * The HUD owns the top strip, so the marker is kept further from that edge
   * than from the other three. A centred rectangle would put it on the health
   * bar, which is the one place it must never be.
   */
  const LOPSIDED = { left: 400, right: 400, top: 120, bottom: 300 };

  it('keeps a target further away above than below', () => {
    expect(edgeMark(0, -400, LOPSIDED).y).toBe(-120);
    expect(edgeMark(0, 400, LOPSIDED).y).toBe(300);
  });

  it('calls a target visible by the side it is actually on', () => {
    expect(edgeMark(0, -200, LOPSIDED).onScreen).toBe(false);
    expect(edgeMark(0, 200, LOPSIDED).onScreen).toBe(true);
  });

  it('still lands on the border from every direction', () => {
    for (let i = 0; i < 64; i++) {
      const angle = (i * Math.PI * 2) / 64;
      const mark = edgeMark(Math.cos(angle) * 5000, Math.sin(angle) * 5000, LOPSIDED);
      expect(mark.onScreen).toBe(false);
      expect(onBorder(mark.x, mark.y, LOPSIDED)).toBe(true);
      expect(Math.atan2(mark.y, mark.x)).toBeCloseTo(mark.angle, 9);
    }
  });
});
