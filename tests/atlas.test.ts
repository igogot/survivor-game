import { describe, expect, it } from 'vitest';
import {
  EMBER_FRAMES,
  EMBER_GRID,
  SPRITE_DRAWERS,
  SPRITE_SPECS,
  THREAT_GRID,
  THREAT_RINGS,
  emberCellFits,
  emberFramePixels,
  hexRing,
  packFrames,
  threatBand,
} from '../src/render/atlas';
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

/**
 * The two frames a hostile shot is made of, and the line between them.
 *
 * One makes a promise to the simulation and the other deliberately makes none,
 * which is the whole of the design. The ring is the shot: it is drawn at the
 * radius that damages, because this project's rule is that a thing hits where
 * it is drawn, and the rule does not soften for something aimed *at* the
 * player. The halo hits nobody, and that is its licence to be twice the size —
 * fourteen pixels cannot be made findable in a crowd of six hundred by shaping
 * them, only by putting something around them.
 */
describe("the horde's shot", () => {
  it('draws the ring at exactly the radius it hits', () => {
    for (const size of [16, 32, 64]) {
      const ring = hexRing(size);

      // The sprite is scaled so the frame spans `radius * 2`, so the outer edge
      // of the stroke has to land on the frame's own edge. It used to sit a
      // whole further stroke width inside, which drew the shot smaller than it
      // hit — wrong in the one direction a projectile must never be wrong.
      expect(ring.radius + ring.width / 2, `${size}px`).toBeCloseTo(size / 2);
      // Still a ring: a stroke thick enough to close over the middle would be a
      // dot, and a dot is what the frame exists not to be.
      expect(ring.radius - ring.width / 2, `${size}px`).toBeGreaterThan(0);
    }
  });

  it('fades the halo outward and never brightens on the way', () => {
    expect(THREAT_RINGS.length).toBeGreaterThan(1);

    THREAT_RINGS.forEach((alpha, band) => {
      expect(alpha, `band ${band}`).toBeGreaterThan(0);
      expect(alpha, `band ${band}`).toBeLessThanOrEqual(1);
      if (band > 0) expect(alpha, `band ${band}`).toBeLessThan(THREAT_RINGS[band - 1]);
    });
  });

  /**
   * A square halo would read as a tile, and a dozen shots as a row of tiles.
   * The corners are the whole test: they are what a distance measured to the
   * cell's corner rather than its middle would light.
   */
  it('keeps the halo round', () => {
    expect(threatBand(0, 0)).toBe(-1);
    expect(threatBand(THREAT_GRID - 1, 0)).toBe(-1);
    expect(threatBand(0, THREAT_GRID - 1)).toBe(-1);
    expect(threatBand(THREAT_GRID - 1, THREAT_GRID - 1)).toBe(-1);
    expect(threatBand(THREAT_GRID / 2, THREAT_GRID / 2)).toBe(0);
  });

  /**
   * The band is a function of distance and of nothing else, which is what makes
   * the halo read as one glow instead of as a pattern. Checked over every pair
   * of cells rather than by inspection: a glow with a bright ring loose in it
   * is the sort of thing a retune leaves behind and no eye catches at 30px.
   */
  it('never puts a brighter cell further out than a dimmer one', () => {
    const middle = THREAT_GRID / 2;
    const lit: { reach: number; alpha: number }[] = [];

    for (let row = 0; row < THREAT_GRID; row++) {
      for (let col = 0; col < THREAT_GRID; col++) {
        const band = threatBand(col, row);
        if (band < 0) continue;
        expect(band, `(${col}, ${row})`).toBeLessThan(THREAT_RINGS.length);
        lit.push({
          reach: Math.hypot(col + 0.5 - middle, row + 0.5 - middle),
          alpha: THREAT_RINGS[band],
        });
      }
    }

    expect(lit.length).toBeGreaterThan(THREAT_GRID * 2);
    for (const a of lit) {
      for (const b of lit) {
        if (a.reach < b.reach) expect(a.alpha).toBeGreaterThanOrEqual(b.alpha);
      }
    }
  });
});

/**
 * The one drawn shape that makes a promise about the simulation.
 *
 * A patch of burning ground damages its full radius, and this project's rule is
 * that a weapon hits where it is drawn. The fire may therefore never be painted
 * past the circle it burns — a lit cell is a square of paint, so it is the
 * corner of the cell that has to be inside and not its middle. Nothing else
 * would catch a stray pixel: an atlas frame is pixels, and pixels have no test.
 */
describe('the ember frames', () => {
  const frames = EMBER_FRAMES.map((_, index) => emberFramePixels(index));
  const middle = EMBER_GRID / 2;

  /** How far the middle of a cell sits from the middle of the frame. */
  function reach(col: number, row: number): number {
    return Math.hypot(col + 0.5 - middle, row + 0.5 - middle);
  }

  function lit(rows: readonly string[]): { col: number; row: number; mark: string }[] {
    const cells: { col: number; row: number; mark: string }[] = [];
    rows.forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        if (line[col] !== '.') cells.push({ col, row, mark: line[col] });
      }
    });
    return cells;
  }

  it('has a frame for every name the renderer cycles', () => {
    expect(EMBER_FRAMES.length).toBeGreaterThan(1);

    for (const [index, name] of EMBER_FRAMES.entries()) {
      expect(emberFramePixels(index), name).toHaveLength(EMBER_GRID);
      expect(SPRITE_DRAWERS[name], name).toBeTypeOf('function');
      expect(
        SPRITE_SPECS.some((spec) => spec.name === name),
        `${name} is cycled but never packed`,
      ).toBe(true);
    }
  });

  it('is a square grid of three kinds of cell and nothing else', () => {
    for (const rows of frames) {
      for (const line of rows) {
        expect(line).toHaveLength(EMBER_GRID);
        expect(line).toMatch(/^[#+.]+$/);
      }
    }
  });

  it('never paints past what the patch burns', () => {
    frames.forEach((rows, index) => {
      for (const cell of lit(rows)) {
        expect(
          emberCellFits(cell.col, cell.row),
          `frame ${index} lights (${cell.col}, ${cell.row}) outside the burn`,
        ).toBe(true);
      }
    });
  });

  /**
   * The other end of the same promise. Fire drawn well inside its own radius
   * would be honest and useless: the ribbon would look narrower than the ground
   * it kills on, and the player would walk enemies through fire they cannot see.
   */
  it('reaches the edge of what it burns', () => {
    frames.forEach((rows, index) => {
      const farthest = Math.max(...lit(rows).map((cell) => reach(cell.col, cell.row)));
      expect(farthest, `frame ${index}`).toBeGreaterThan(middle - 1.6);
    });
  });

  it('has a hot middle and a cooler edge', () => {
    frames.forEach((rows, index) => {
      const marks = lit(rows);
      expect(marks.filter((cell) => cell.mark === '#').length, `frame ${index}`).toBeGreaterThan(20);
      expect(marks.filter((cell) => cell.mark === '+').length, `frame ${index}`).toBeGreaterThan(20);

      // The hot cells are the middle of the fire, not scattered through it.
      const hot = marks.filter((cell) => cell.mark === '#');
      const outermostHot = Math.max(...hot.map((cell) => reach(cell.col, cell.row)));
      const outermostDim = Math.max(
        ...marks.filter((cell) => cell.mark === '+').map((cell) => reach(cell.col, cell.row)),
      );
      expect(outermostHot, `frame ${index}`).toBeLessThan(outermostDim);
    });
  });

  /**
   * Four identical frames are a still picture with extra steps, and that is
   * exactly what a careless retune would leave behind.
   */
  it('shows a different picture in every frame', () => {
    const seen = new Set(frames.map((rows) => rows.join('|')));
    expect(seen.size).toBe(frames.length);
  });
});
