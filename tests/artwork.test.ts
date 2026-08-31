import { describe, expect, it } from 'vitest';
import { SHEET_COLUMNS, SHEET_TILES, SPRITE_TILES, TILE_SIZE, tileOrigin } from '../src/render/artwork';
import { SPRITE_DRAWERS, SPRITE_SPECS } from '../src/render/atlas';
import type { SpriteName } from '../src/data/sprites';

/**
 * The sprites with no artwork behind them.
 *
 * A shockwave is an expanding outline and a dungeon tileset has no such thing.
 * The lance is worse: it is the one frame stretched to fit its own reach, and a
 * 16px icon smeared eight times along one axis reads as a smudge rather than as
 * a weapon. Both keep the shapes this project draws for them. Listing them here
 * rather than allowing any gap is the point — a sprite that quietly lost its
 * art would otherwise look like a deliberate choice.
 */
const DRAWN_ONLY: readonly SpriteName[] = ['ring', 'spear'];

describe('sprite artwork', () => {
  it('gives every sprite either a tile or a deliberate exemption', () => {
    for (const spec of SPRITE_SPECS) {
      const tile = SPRITE_TILES[spec.name];
      const exempt = DRAWN_ONLY.includes(spec.name);

      expect(tile !== undefined || exempt, `${spec.name} has neither artwork nor an exemption`).toBe(
        true,
      );
      expect(tile !== undefined && exempt, `${spec.name} is both drawn and exempt`).toBe(false);
    }
  });

  it('names only tiles that exist in the sheet', () => {
    for (const [name, tile] of Object.entries(SPRITE_TILES)) {
      expect(tile, name).toBeGreaterThanOrEqual(0);
      expect(tile, name).toBeLessThan(SHEET_TILES);
      expect(Number.isInteger(tile), name).toBe(true);
    }
  });

  /**
   * Two sprites on one tile is always a copy-paste slip: the whole point of the
   * selection is that a bat and a crab do not look alike.
   */
  it('never points two sprites at the same tile', () => {
    const seen = new Map<number, string>();

    for (const [name, tile] of Object.entries(SPRITE_TILES)) {
      const previous = seen.get(tile);
      expect(previous, `${name} reuses the tile already taken by ${previous}`).toBeUndefined();
      seen.set(tile, name);
    }
  });

  it('keeps every tile inside the sheet it is cut from', () => {
    const rows = Math.ceil(SHEET_TILES / SHEET_COLUMNS);

    for (const [name, tile] of Object.entries(SPRITE_TILES)) {
      const origin = tileOrigin(tile);

      expect(origin.x + TILE_SIZE, name).toBeLessThanOrEqual(SHEET_COLUMNS * TILE_SIZE);
      expect(origin.y + TILE_SIZE, name).toBeLessThanOrEqual(rows * TILE_SIZE);
    }
  });

  it('maps an index to its row and column', () => {
    expect(tileOrigin(0)).toEqual({ x: 0, y: 0 });
    expect(tileOrigin(SHEET_COLUMNS - 1)).toEqual({ x: (SHEET_COLUMNS - 1) * TILE_SIZE, y: 0 });
    expect(tileOrigin(SHEET_COLUMNS)).toEqual({ x: 0, y: TILE_SIZE });
  });

  /**
   * The fallback has to cover everything, not just the sprites without art:
   * when the sheet fails to load, every frame falls back at once.
   */
  it('can draw every sprite without the artwork', () => {
    for (const spec of SPRITE_SPECS) {
      expect(SPRITE_DRAWERS[spec.name], spec.name).toBeTypeOf('function');
    }
  });

  /**
   * Frames are whole multiples of the source tile, which is what lets the atlas
   * scale pixel art up with smoothing off and no half-pixel seams.
   */
  it('sizes every frame to a whole number of source tiles', () => {
    for (const spec of SPRITE_SPECS) {
      expect(spec.size % TILE_SIZE, `${spec.name} is ${spec.size}px`).toBe(0);
    }
  });
});
