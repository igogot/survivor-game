/**
 * The land the run is fought on.
 *
 * A second Kenney pack, "Tiny Town" (CC0), cut to the same 16px grid as the
 * dungeon sheet the sprites come from and drawn to sit beside it. The dungeon
 * pack has no outdoors in it at all — no earth, no grass, nothing that grows,
 * and no wall that is meant to be seen from outside the room. Three attempts
 * were made at building a landscape out of its furniture and all three came
 * out as gravel, because the tiles were never architecture to begin with.
 *
 * What is drawn here is one patch, once, at startup. A single TilingSprite
 * repeats it, so the whole ground stays one draw call however far the player
 * walks.
 *
 * The rule that took three tries to learn: **multi-tile art is stamped whole,
 * never sampled.** A tree in this pack is one cell wide and three tall — crown,
 * crown, trunk — and a wall is three rows deep. Dropping any single cell of one
 * on its own is what produced floating crowns, goblets and headless masonry.
 * Everything below is either a whole stamp or a tile that is genuinely one
 * cell: a bush, a sprout, a cluster of mushrooms.
 */

import townUrl from '../assets/kenney-tiny-town.png';
import { TILE_SIZE, tileOrigin } from './artwork';

/** Side of one ground cell on screen, in pixels. */
const CELL = 32;

/**
 * Cells along one side of the repeating patch.
 *
 * The patch is what the TilingSprite repeats, so this is how far the player
 * walks before the land says the same thing twice. Thirty-two cells is 1024px,
 * about half a screen: close enough to notice if you look for it, far enough
 * that a house does not appear three times at once.
 */
const PATCH = 32;

/**
 * How the land is dimmed once it is laid.
 *
 * Kenney draws for daylight, and everything this game puts on the ground is
 * small, saturated and has to be found in a crowd. Half the light out, pulled
 * a little towards blue: the blue is what stops the grass from staying a green
 * that the green slime disappears into.
 */
const SHADE = 'rgba(12, 14, 26, 0.52)';

/** Painted under everything, so a transparent corner is still ground. */
const BASE = '#3a2c20';

/**
 * Grass, weighted.
 *
 * Three plain cuts, three lightly textured, one in flower. The flowering cut
 * was a third of the field to begin with, which is not a meadow — it is polka
 * dots.
 */
const GRASS: readonly number[] = [0, 0, 0, 1, 1, 1, 2];

/** Bare earth: a 3x3 patch with its own edges, and a fill for the middle. */
const EARTH_EDGES: readonly (readonly number[])[] = [
  [12, 13, 14],
  [24, 25, 26],
  [36, 37, 38],
];
const EARTH_FILL = 25;

/** A tree: one cell wide, three tall. Two kinds, green and turning. */
const TREES: readonly (readonly (readonly number[])[])[] = [
  [[3], [15], [27]],
  [[4], [16], [28]],
];

/** Genuinely one cell each: a bush, two sprouts, a cluster of mushrooms. */
const SCRUB: readonly number[] = [5, 17, 29];

/** A signpost, a barrel, a handcart. */
const PROPS: readonly number[] = [83, 106, 107];

/** A house: two rows of roof over a wall with a door in it. */
const HOUSES: readonly (readonly (readonly number[])[])[] = [
  [
    [48, 49, 50],
    [60, 61, 62],
    [76, 90, 79],
  ],
  [
    [52, 53, 54],
    [64, 65, 66],
    [72, 86, 75],
  ],
];

/** Old stone wall: battlements, body, footing. Ends cap, middles repeat. */
const WALL_ROWS: readonly (readonly number[])[] = [
  [96, 97, 98],
  [108, 109, 110],
  [120, 121, 122],
];

/** A stretch of fence, two rows deep. */
const FENCE: readonly (readonly number[])[] = [
  [44, 45, 46],
  [68, 69, 70],
];

/**
 * How much of each thing goes into one patch.
 *
 * Deliberately sparse. The reference is the open stage of a survivor-like,
 * which is a field with a few things standing in it — not a village. A busy
 * background is one the player has to look past for forty minutes.
 */
const HOUSE_COUNT = 3;
const WALL_COUNT = 3;
const GROVE_COUNT = 9;
const FENCE_COUNT = 3;
const PROP_COUNT = 5;
const EARTH_COUNT = 9;

/** Trees in one grove, and how rare a lone tree or a tuft of scrub is. */
const GROVE_MIN = 2;
const GROVE_MAX = 4;
const TREE_RARITY = 53;
const SCRUB_RARITY = 29;

/** Tries before a thing gives up on finding room. */
const PLACEMENT_TRIES = 40;

/**
 * Loads the land's sheet, or rejects.
 *
 * `decode()` rather than an `onload` handler, for the same reason the sprite
 * sheet uses it: a decode failure is reported as a rejection instead of a
 * silently blank image.
 */
export async function loadTownSheet(): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = townUrl;
  await image.decode();
  return image;
}

/**
 * Side of the patch in pixels.
 *
 * Not exported: the renderer wraps the background by the size of the texture
 * it was handed, which is the only reading that stays right when the artwork
 * fails and the fallback grid is a different size.
 */
const PATCH_SIZE = CELL * PATCH;

/**
 * Lays one patch of land.
 *
 * Everything wraps by the patch, so a wall or a grove running off one edge
 * carries on at the other and the patch tiles against itself.
 *
 * Nothing is drawn from the run's PRNG. That stream belongs to the balance
 * table, and one extra draw from the renderer would move every seed the stand
 * has ever measured — so every choice here is hashed, from a cell's own
 * coordinates or from the number of the thing being placed.
 */
export function drawGround(sheet: CanvasImageSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PATCH_SIZE;
  canvas.height = PATCH_SIZE;

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context is unavailable');

  const land = new Land(ctx, sheet);
  land.lay();

  return canvas;
}

/** Which cells are spoken for, so two things never stand in one place. */
class Land {
  private readonly taken = new Uint8Array(PATCH * PATCH);

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly sheet: CanvasImageSource,
  ) {}

  lay(): void {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = BASE;
    this.ctx.fillRect(0, 0, PATCH_SIZE, PATCH_SIZE);

    this.layGrass();
    this.layEarth();

    for (let k = 0; k < HOUSE_COUNT; k++) {
      this.place(HOUSES[k % HOUSES.length], mix(1000 + k, 17));
    }

    this.layWalls();
    this.layGroves();

    for (let k = 0; k < FENCE_COUNT; k++) this.place(FENCE, mix(3000 + k, 41));

    for (let k = 0; k < PROP_COUNT; k++) {
      const seed = mix(4000 + k, 53);
      this.place([[pick(PROPS, seed)]], seed);
    }

    this.layScatter();

    this.ctx.fillStyle = SHADE;
    this.ctx.fillRect(0, 0, PATCH_SIZE, PATCH_SIZE);
  }

  /**
   * The grass under everything.
   *
   * Keyed on a different mix of the coordinates than anything else uses. With
   * one key for the whole patch the flowering cut lined itself up into
   * diagonals, which is the sort of pattern the eye locks onto and follows.
   */
  private layGrass(): void {
    for (let row = 0; row < PATCH; row++) {
      for (let col = 0; col < PATCH; col++) {
        this.blit(pick(GRASS, mix(col * 3 + 1, row * 7 + 2)), col, row);
      }
    }
  }

  /**
   * Bare earth, laid as patches with their own edges.
   *
   * Not claimed: a clearing is ground rather than a thing standing on it, and
   * a tree at the edge of one is a tree at the edge of a clearing.
   */
  private layEarth(): void {
    for (let k = 0; k < EARTH_COUNT; k++) {
      const seed = mix(5000 + k, 61);
      const width = 3 + ((seed >>> 3) % 4);
      const height = 3 + ((seed >>> 7) % 3);
      const rows: number[][] = [widen(EARTH_EDGES[0], width)];

      for (let i = 0; i < height - 2; i++) {
        rows.push([EARTH_EDGES[1][0], ...filled(EARTH_FILL, width - 2), EARTH_EDGES[1][2]]);
      }
      rows.push(widen(EARTH_EDGES[2], width));

      this.place(rows, seed, false);
    }
  }

  /** Old walls, each with a stretch knocked out of it. */
  private layWalls(): void {
    for (let k = 0; k < WALL_COUNT; k++) {
      const seed = mix(2000 + k, 29);
      const width = 4 + ((seed >>> 4) % 3);
      const gap = 1 + ((seed >>> 9) % (width - 2));
      this.place(
        WALL_ROWS.map((line) => widen(line, width)),
        seed,
        true,
        gap,
      );
    }
  }

  /** A grove is a few whole trees standing near each other. */
  private layGroves(): void {
    for (let k = 0; k < GROVE_COUNT; k++) {
      const seed = mix(6000 + k, 71);
      const left = seed % PATCH;
      const top = (seed >>> 8) % PATCH;
      const trees = GROVE_MIN + ((seed >>> 16) % (GROVE_MAX - GROVE_MIN + 1));

      for (let t = 0; t < trees; t++) {
        const own = mix(seed + t, 97);
        const col = left + (own % 6) - 3;
        const row = top + (((own >>> 5) % 4) - 2);
        if (!this.isFree(col, row, 1, 3)) continue;

        this.claim(col, row, 1, 3);
        this.stamp(pick(TREES, own), col, row);
      }
    }
  }

  /** Lone trees and tufts of scrub, over whatever ground is left. */
  private layScatter(): void {
    for (let row = 0; row < PATCH; row++) {
      for (let col = 0; col < PATCH; col++) {
        if (this.taken[row * PATCH + col] !== 0) continue;

        const own = mix(col + 101, row + 57);
        if (own % TREE_RARITY === 0 && this.isFree(col, row, 1, 3)) {
          this.claim(col, row, 1, 3);
          this.stamp(pick(TREES, own), col, row);
        } else if (own % SCRUB_RARITY === 0) {
          this.claim(col, row, 1, 1);
          this.blit(pick(SCRUB, own), col, row);
        }
      }
    }
  }

  /**
   * Finds room for a stamp and puts it down, or gives up.
   *
   * Giving up quietly is the right answer for a patch that is already full:
   * one house fewer is nothing, and growing the patch until everything fits
   * would make the repeat visible.
   */
  private place(
    rows: readonly (readonly number[])[],
    seed: number,
    claim = true,
    gap = -1,
  ): void {
    const height = rows.length;
    const width = rows[0].length;

    for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
      const own = mix(seed, attempt * 31 + 7);
      const col = own % PATCH;
      const row = (own >>> 8) % PATCH;

      if (claim) {
        if (!this.isFree(col, row, width, height)) continue;
        this.claim(col, row, width, height);
      }

      this.stamp(rows, col, row, gap);
      return;
    }
  }

  private stamp(
    rows: readonly (readonly number[])[],
    col: number,
    row: number,
    gap = -1,
  ): void {
    for (let dy = 0; dy < rows.length; dy++) {
      for (let dx = 0; dx < rows[dy].length; dx++) {
        if (dx === gap) continue;
        this.blit(rows[dy][dx], col + dx, row + dy);
      }
    }
  }

  /**
   * Whether a stamp fits, with a cell of daylight all round it.
   *
   * The margin is the point: two things sharing an edge read as one confusing
   * shape, and a single cell between them is enough to tell them apart.
   */
  private isFree(col: number, row: number, width: number, height: number): boolean {
    for (let dy = -1; dy <= height; dy++) {
      for (let dx = -1; dx <= width; dx++) {
        if (this.taken[wrap(row + dy) * PATCH + wrap(col + dx)] !== 0) return false;
      }
    }
    return true;
  }

  private claim(col: number, row: number, width: number, height: number): void {
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        this.taken[wrap(row + dy) * PATCH + wrap(col + dx)] = 1;
      }
    }
  }

  /** Doubles one source tile onto a cell, wrapping the patch. */
  private blit(tile: number, col: number, row: number): void {
    const origin = tileOrigin(tile);
    this.ctx.drawImage(
      this.sheet,
      origin.x,
      origin.y,
      TILE_SIZE,
      TILE_SIZE,
      wrap(col) * CELL,
      wrap(row) * CELL,
      CELL,
      CELL,
    );
  }
}

function wrap(value: number): number {
  return ((value % PATCH) + PATCH) % PATCH;
}

function widen(line: readonly number[], width: number): number[] {
  return [line[0], ...filled(line[1], width - 2), line[2]];
}

function filled(tile: number, count: number): number[] {
  return new Array<number>(Math.max(0, count)).fill(tile);
}

function pick<T>(items: readonly T[], hash: number): T {
  return items[hash % items.length];
}

/**
 * A stable, well-spread number from a pair of coordinates.
 *
 * `Math.imul` rather than plain multiplication because the constants are large
 * enough that a double would silently lose the low bits — and the low bits are
 * the only ones a modulo reads, so the land would come out in stripes.
 */
function mix(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}
