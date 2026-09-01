import { describe, expect, it } from 'vitest';
import { SPRITE_DRAWERS, SPRITE_SPECS, packFrames } from '../src/render/atlas';
import type { Frame } from '../src/render/atlas';

function overlaps(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('packFrames', () => {
  it('gives every sprite a frame', () => {
    const layout = packFrames(SPRITE_SPECS);

    for (const spec of SPRITE_SPECS) {
      const frame = layout.frames[spec.name];
      expect(frame, spec.name).toBeDefined();
      expect(frame.w, spec.name).toBe(spec.width ?? spec.size);
      expect(frame.h, spec.name).toBe(spec.size);
    }
  });

  /**
   * The lance is drawn on a frame six times wider than it is tall, and shelf
   * packing measures a shelf by height. Width has to be what decides when a row
   * is full and height what decides how tall it is; swapping the two puts a
   * 192px frame into a 32px hole and every sprite after it comes out wearing a
   * neighbour.
   */
  it('lays a frame wider than it is tall without disturbing the shelf', () => {
    const layout = packFrames([
      { name: 'grunt', size: 32 },
      { name: 'spear', size: 32, width: 192 },
      { name: 'bolt', size: 32 },
    ]);

    expect(layout.frames.spear.w).toBe(192);
    // The two square frames share a shelf; the wide one does not fit beside
    // them and starts a fresh one at the left edge.
    expect(layout.frames.bolt.y).toBe(layout.frames.grunt.y);
    expect(layout.frames.spear.y).toBeGreaterThan(layout.frames.bolt.y);
    expect(layout.frames.spear.x).toBe(layout.frames.bolt.x);
    expect(layout.width).toBeLessThanOrEqual(256);
    // Two shelves of 32, not three, and not one 192 tall: the wide frame took
    // width from the row and height from itself.
    expect(layout.height).toBeLessThan(32 * 3);
  });

  /**
   * The failure this guards against is silent: overlapping frames render as one
   * sprite wearing a corner of another, which looks like a drawing bug rather
   * than a packing bug.
   */
  it('never overlaps two frames', () => {
    const layout = packFrames(SPRITE_SPECS);
    const entries = Object.entries(layout.frames);

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [nameA, a] = entries[i];
        const [nameB, b] = entries[j];
        expect(overlaps(a, b), `${nameA} overlaps ${nameB}`).toBe(false);
      }
    }
  });

  it('keeps every frame inside the canvas it reports', () => {
    const layout = packFrames(SPRITE_SPECS);

    for (const [name, frame] of Object.entries(layout.frames)) {
      expect(frame.x, name).toBeGreaterThanOrEqual(0);
      expect(frame.y, name).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.w, name).toBeLessThanOrEqual(layout.width);
      expect(frame.y + frame.h, name).toBeLessThanOrEqual(layout.height);
    }
  });

  it('produces the same layout every run', () => {
    expect(packFrames(SPRITE_SPECS)).toEqual(packFrames(SPRITE_SPECS));
  });

  it('wraps onto a new row rather than growing sideways forever', () => {
    const many = Array.from({ length: 12 }, () => ({ name: 'grunt', size: 64 }) as const);
    const layout = packFrames(many);

    expect(layout.width).toBeLessThanOrEqual(256);
    expect(layout.height).toBeGreaterThan(64);
  });
});

describe('sprite catalogue', () => {
  it('can draw every frame it packs', () => {
    for (const spec of SPRITE_SPECS) {
      expect(SPRITE_DRAWERS[spec.name], spec.name).toBeTypeOf('function');
    }
  });

  it('draws every silhouette the enemy data asks for', async () => {
    const { ENEMIES, BOSS } = await import('../src/data/enemies');

    for (const def of [...ENEMIES, BOSS]) {
      expect(SPRITE_DRAWERS[def.sprite], def.id).toBeTypeOf('function');
    }
  });

  it('gives each enemy type its own silhouette', async () => {
    const { ENEMIES, BOSS } = await import('../src/data/enemies');
    const names = [...ENEMIES, BOSS].map((def) => def.sprite);

    expect(new Set(names).size).toBe(names.length);
  });
});
