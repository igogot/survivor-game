/**
 * Where the pixels come from.
 *
 * `src/render/atlas.ts` owns the shapes this game falls back to; this file owns
 * the artwork it prefers. Both feed the same packed atlas, so the renderer
 * never learns which one it got — see `createTextures()`.
 *
 * The art is Kenney's "Tiny Dungeon" (CC0), shipped as the sheet it comes in
 * rather than re-exported: 16px tiles in a 12-column grid, already packed. The
 * licence sits beside it in `kenney-tiny-dungeon.license.txt`.
 */

import sheetUrl from '../assets/kenney-tiny-dungeon.png';
import type { SpriteName } from '../data/sprites';

/** Side of one tile in the source sheet, in pixels. */
export const TILE_SIZE = 16;
/** Tiles per row in the source sheet; an index maps to a cell through this. */
export const SHEET_COLUMNS = 12;
/** Tiles in the sheet. Indices outside this are a typo, not a sprite. */
export const SHEET_TILES = 132;

/**
 * Which tile each sprite is drawn from.
 *
 * Chosen for silhouette first, because a crowd is read by shape long before
 * colour: the runner is a bat so it looks quick standing still, the brute is a
 * crab so it looks like it takes a while to kill, and the boss is a spider so
 * it cannot be mistaken for a large brute.
 *
 * `ring` and `spear` are absent on purpose. The shockwave is an expanding
 * outline with no equivalent in a dungeon tileset, and the lance is stretched
 * to the reach of its thrust — a 16px icon smeared eight times along one axis
 * reads as a smudge, not as a weapon. Both keep their drawn shape even when the
 * artwork loads. Anything missing here falls through to `SPRITE_DRAWERS`.
 */
export const SPRITE_TILES: Readonly<Partial<Record<SpriteName, number>>> = {
  playerBolt: 98, // bare-headed soldier: the one who shoots first
  playerOrbit: 96, // knight in a full helm, which is what a bodyguard looks like
  playerNova: 84, // wizard, and the only figure on the sheet dressed in nova's purple
  playerSpear: 86, // bearded fighter in leather: the one head not confusable with the other three
  playerHarpoon: 100, // grey-haired hunter, told apart at a glance by the light head
  grunt: 108, // green slime
  runner: 120, // bat
  brute: 110, // crab
  splitter: 123, // mushroom: a fungus bursting into spores needs no explaining
  spawnling: 124, // small round blob, the spore itself
  caster: 109, // robed figure, the only humanoid in the horde
  bomber: 121, // pale wisp, the least solid thing in the sheet
  hex: 114, // green flask, which reads as something thrown
  boss: 122, // spider
  bolt: 103, // dagger, rotated to face its travel
  harpoon: 131, // spike on a haft: the same rotation, twice the weight
  orb: 118, // axe head, which reads as a blade when it circles
  gem: 116, // blue flask
  gemRich: 115, // red flask, for pickups worth more
};

/**
 * The flat colour every tile is painted on.
 *
 * Kenney's tiles are drawn for a dungeon floor, so each one sits on an opaque
 * rounded card — 57% of the boss tile is this single colour. Left in, every
 * entity would carry a visible dark tile around it and a crowd would read as a
 * grid. It appears nowhere inside the sprites themselves, which is what makes
 * removing it safe.
 */
export const TILE_BACKING = { r: 63, g: 38, b: 49 } as const;

/**
 * Returns the sheet with its backing punched out.
 *
 * Done once for the whole sheet rather than per frame: the atlas scales tiles
 * up by whole pixels, so keying before the scale means comparing exact colours
 * instead of guessing at a tolerance for interpolated ones.
 */
export function stripTileBacking(sheet: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sheet.naturalWidth;
  canvas.height = sheet.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context is unavailable');

  ctx.drawImage(sheet, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      pixels[i] === TILE_BACKING.r &&
      pixels[i + 1] === TILE_BACKING.g &&
      pixels[i + 2] === TILE_BACKING.b
    ) {
      pixels[i + 3] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);

  return canvas;
}

/** Top-left corner of a tile in the sheet. */
export function tileOrigin(index: number): { x: number; y: number } {
  return {
    x: (index % SHEET_COLUMNS) * TILE_SIZE,
    y: Math.floor(index / SHEET_COLUMNS) * TILE_SIZE,
  };
}

/**
 * Loads the sheet, or rejects.
 *
 * `decode()` rather than an `onload` handler because it reports a decode
 * failure as a rejection instead of a silently blank image, and a blank sheet
 * would paint every entity as nothing at all.
 */
export async function loadSpriteSheet(): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = sheetUrl;
  await image.decode();
  return image;
}
