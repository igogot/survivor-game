import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { SpatialGrid } from '../src/world/grid';

describe('SpatialGrid', () => {
  /**
   * The single property that matters for a broad-phase: it may hand back
   * candidates that turn out to be too far, but it must never miss one that
   * genuinely overlaps. A miss means projectiles silently pass through enemies,
   * which is close to impossible to spot by playing.
   */
  it('never misses a point inside the query circle', () => {
    const rng = new Rng(0xc0ffee);
    const grid = new SpatialGrid(64);
    const points: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < 3000; i++) {
      const point = { x: rng.range(-2000, 2000), y: rng.range(-2000, 2000) };
      points.push(point);
      grid.insert(i, point.x, point.y);
    }

    const candidates: number[] = [];

    for (let q = 0; q < 200; q++) {
      const cx = rng.range(-2000, 2000);
      const cy = rng.range(-2000, 2000);
      const radius = rng.range(5, 400);

      grid.query(cx, cy, radius, candidates);
      const returned = new Set(candidates);

      for (let i = 0; i < points.length; i++) {
        const dx = points[i].x - cx;
        const dy = points[i].y - cy;
        const overlaps = dx * dx + dy * dy <= radius * radius;
        if (overlaps) {
          expect(returned.has(i)).toBe(true);
        }
      }
    }
  });

  it('handles negative coordinates', () => {
    const grid = new SpatialGrid(32);
    grid.insert(0, -500, -500);
    grid.insert(1, 500, 500);

    const out: number[] = [];
    grid.query(-500, -500, 10, out);

    expect(out).toContain(0);
    expect(out).not.toContain(1);
  });

  it('drops everything on clear', () => {
    const grid = new SpatialGrid(32);
    grid.insert(0, 10, 10);
    grid.clear();

    const out: number[] = [];
    grid.query(10, 10, 50, out);

    expect(out).toHaveLength(0);
  });
});
