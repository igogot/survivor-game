import { Spritesheet, Texture } from 'pixi.js';
import type { SpritesheetData, SpritesheetFrameData } from 'pixi.js';
import { SPRITE_DRAWERS, SPRITE_SPECS, packFrames } from './atlas';
import {
  FLOOR_TILES,
  RUBBLE_TILES,
  RUIN_TILES,
  SPRITE_TILES,
  TILE_SIZE,
  loadSpriteSheet,
  stripTileBacking,
  tileOrigin,
} from './artwork';
import type { AtlasLayout, Frame } from './atlas';
import type { SpriteName } from '../data/sprites';

/** Side of the empty grid drawn when there is no sheet to build a floor from. */
const GRID_TEXTURE_SIZE = 64;

/**
 * Side of one flagstone on screen, in pixels.
 *
 * Twice the 16px source tile, and the camera is at 1:1, so a stone is 32 world
 * units across — a little wider than the player and wider than everything in
 * the horde but the boss. Big enough to read as masonry rather than as noise,
 * small enough that the ground still streams past at speed.
 *
 * A whole multiple of the source on purpose: the pixels double instead of
 * being interpolated, which is what keeps the floor as sharp as what stands
 * on it.
 */
const FLOOR_TILE_SIZE = 32;

/**
 * Flagstones along one side of the repeating patch.
 *
 * The patch is what a TilingSprite repeats, so this is the distance before the
 * floor says the same thing twice: twelve stones is 384px, wider than a third
 * of most screens. Smaller and the scattered rubble turns into wallpaper; the
 * cost of larger is one canvas built once at startup, so the number is chosen
 * by eye rather than by budget.
 */
const FLOOR_PATCH_TILES = 12;

/**
 * How the floor is dimmed once it is laid.
 *
 * The sheet's sand is bright — it was drawn to be looked at, in a room lit for
 * the purpose. Everything this game puts on top of it is small, saturated and
 * has to be found in a crowd, so the ground is taken down to roughly a quarter
 * of its own brightness and pulled towards the cold of the old empty
 * background. What survives is the texture, which is all the floor was for.
 */
const FLOOR_SHADE = 'rgba(10, 12, 20, 0.74)';

/**
 * Painted under the tiles, in case one lets the canvas through.
 *
 * Keying the backing colour out is a comparison against one exact colour, and
 * nothing guarantees a stray pixel of floor art is not that colour. A dark
 * ground underneath means such a pixel reads as a gap between stones instead
 * of as a hole into nothing.
 */
const FLOOR_BASE = '#2a2018';

/** One rubble tile per this many flagstones, on average. */
const RUBBLE_RARITY = 11;

/** One block of fallen masonry per this many flagstones, on average. */
const RUIN_RARITY = 17;

export interface TextureSet {
  /**
   * The floor the run is fought on, deliberately outside the atlas: a
   * TilingSprite repeats its whole source texture, so a frame packed beside
   * others would drag its neighbours into every tile.
   */
  readonly ground: Texture;
  readonly sprites: Readonly<Record<SpriteName, Texture>>;
  /** False when the atlas failed to build and the per-shape fallback is in use. */
  readonly packed: boolean;
  /**
   * Whether that frame is a white mask, and so has to be tinted into the
   * colour it is meant to be.
   *
   * Per frame rather than per texture set, because the two sources are mixed:
   * the shockwave, the lance and the harpoon keep their drawn shapes even when
   * everything around them is cut from the sheet. Asking the set as a whole
   * gave the wrong answer for exactly those three, and each of them had to
   * carry a hand-written exception to work around it.
   *
   * Artwork brings its own colour, so tinting it could only darken it. See how
   * the damage flash is drawn.
   */
  readonly masked: (name: SpriteName) => boolean;
  /**
   * Draws one sprite onto a canvas of the caller's size.
   *
   * The weapon picker has to show the figure each choice turns the player
   * into, and it is DOM rather than scene graph — so it needs the pixels
   * without a `Sprite` to put them in. Going through here rather than calling
   * the drawers directly is what keeps the picker honest: it shows the
   * artwork when the artwork loaded, and the drawn shape when it did not.
   */
  readonly paint: (name: SpriteName, canvas: HTMLCanvasElement) => void;
}

/**
 * The seam between the game and its artwork.
 *
 * Callers get named textures and never learn whether those came from one packed
 * atlas or from nine separate canvases, which is what allows real artwork to
 * arrive without touching the renderer.
 */
export async function createTextures(): Promise<TextureSet> {
  const sheet = await loadArtwork();
  // The floor is the sheet's or it is nothing: without artwork there are no
  // stones to lay, and the empty grid this game shipped with is a better
  // answer than a field of flat colour pretending to be a ruin.
  const ground = Texture.from(
    sheet === null
      ? drawToCanvas(GRID_TEXTURE_SIZE, GRID_TEXTURE_SIZE, drawGrid)
      : drawFloor(sheet),
  );

  try {
    return {
      ground,
      sprites: await packedSprites(sheet),
      packed: true,
      masked: (name) => tileFor(sheet, name) === undefined,
      paint: painter(sheet),
    };
  } catch (error) {
    // A game that renders nothing is worse than a game that renders slower, so
    // a broken atlas degrades to individual textures rather than a blank screen.
    console.warn('Sprite atlas unavailable; falling back to separate textures.', error);
    return {
      ground,
      sprites: separateSprites(),
      packed: false,
      // Nothing was cut from a sheet, so every frame is a mask again.
      masked: () => true,
      paint: painter(null),
    };
  }
}

/**
 * Lays one patch of ruined floor for the background to repeat.
 *
 * Built once at startup and then handed to a single TilingSprite, so the whole
 * ground under the run stays one draw call however far the player walks.
 *
 * Every cell is decided by hashing its own coordinates rather than by drawing
 * from anything: the run's PRNG is the balance table's, and reaching into it
 * from the renderer would move every seed the stand has ever measured. A hash
 * also means the patch is the same floor on every machine and in every run,
 * which is one less thing a screenshot can disagree about.
 *
 * Decoration is laid as whole tiles and never crosses a cell edge, which is
 * what lets the patch tile seamlessly against itself: the sheet's tiles were
 * cut to sit side by side, and nothing here does anything they were not
 * already drawn to do.
 */
function drawFloor(artwork: CanvasImageSource): HTMLCanvasElement {
  const side = FLOOR_TILE_SIZE * FLOOR_PATCH_TILES;

  return drawToCanvas(side, side, (ctx) => {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = FLOOR_BASE;
    ctx.fillRect(0, 0, side, side);

    for (let row = 0; row < FLOOR_PATCH_TILES; row++) {
      for (let col = 0; col < FLOOR_PATCH_TILES; col++) {
        const x = col * FLOOR_TILE_SIZE;
        const y = row * FLOOR_TILE_SIZE;

        blitFloorTile(ctx, artwork, pick(FLOOR_TILES, mix(col, row)), x, y);

        // A second, unrelated hash of the same cell. One key for both would
        // tie what lies on a stone to which stone it is, and the floor would
        // show five combinations instead of five times six.
        const litter = mix(col + 101, row + 57);
        if (litter % RUIN_RARITY === 0) {
          blitFloorTile(ctx, artwork, pick(RUIN_TILES, litter), x, y);
        } else if (litter % RUBBLE_RARITY === 0) {
          blitFloorTile(ctx, artwork, pick(RUBBLE_TILES, litter), x, y);
        }
      }
    }

    ctx.fillStyle = FLOOR_SHADE;
    ctx.fillRect(0, 0, side, side);
  });
}

/** Doubles one source tile onto the patch. */
function blitFloorTile(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  tile: number,
  x: number,
  y: number,
): void {
  const origin = tileOrigin(tile);
  ctx.drawImage(
    artwork,
    origin.x,
    origin.y,
    TILE_SIZE,
    TILE_SIZE,
    x,
    y,
    FLOOR_TILE_SIZE,
    FLOOR_TILE_SIZE,
  );
}

function pick(tiles: readonly number[], hash: number): number {
  return tiles[hash % tiles.length];
}

/**
 * A stable, well-spread number from a pair of cell coordinates.
 *
 * `Math.imul` rather than plain multiplication because the constants are large
 * enough that a double would silently lose the low bits — which are the only
 * ones a modulo reads, so the floor would come out in stripes.
 */
function mix(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * The artwork is preferred, never required.
 *
 * A missing or undecodable sheet is a bad afternoon, not a broken build: the
 * shapes this project shipped with are still there and still correct, so the
 * game keeps running with placeholder geometry instead of refusing to start.
 */
async function loadArtwork(): Promise<CanvasImageSource | null> {
  try {
    return stripTileBacking(await loadSpriteSheet());
  } catch (error) {
    console.warn('Sprite artwork unavailable; falling back to drawn shapes.', error);
    return null;
  }
}

async function packedSprites(artwork: CanvasImageSource | null): Promise<Record<SpriteName, Texture>> {
  const layout = packFrames(SPRITE_SPECS);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = context(canvas);
  // Every frame size is a whole multiple of the 16px source tile, so turning
  // smoothing off scales the pixel art by whole pixels instead of blurring it.
  ctx.imageSmoothingEnabled = false;

  for (const spec of SPRITE_SPECS) {
    const frame = layout.frames[spec.name];
    if (blitTile(ctx, artwork, spec.name, frame)) continue;

    // Each shape draws in its own coordinate space starting at 0,0 and knows
    // nothing about where it landed in the sheet.
    ctx.save();
    ctx.translate(frame.x, frame.y);
    SPRITE_DRAWERS[spec.name](ctx, frame.w, frame.h);
    ctx.restore();
  }

  const sheet = new Spritesheet(Texture.from(canvas), toSpritesheetData(layout));
  await sheet.parse();

  return collect((name) => sheet.textures[name]);
}

/**
 * A painter bound to whichever source the atlas was built from.
 *
 * The same two-step the atlas itself takes — tile first, drawn shape if there
 * is no tile — so a sprite can never look like one thing in the picker and
 * another in the run.
 */
function painter(artwork: CanvasImageSource | null) {
  return (name: SpriteName, canvas: HTMLCanvasElement): void => {
    const ctx = context(canvas);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frame = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    if (blitTile(ctx, artwork, name, frame)) return;

    // Everything the picker asks for is square, so a shape is given the
    // smaller side twice rather than being stretched to fill an oblong canvas.
    // The lance is the one frame that is not square, and nothing paints it.
    const side = Math.min(canvas.width, canvas.height);
    SPRITE_DRAWERS[name](ctx, side, side);
  };
}

/**
 * Which tile a sprite is cut from, or `undefined` when it is drawn.
 *
 * One decision with two readers — the atlas blits by it and the renderer tints
 * by it — so a frame cannot be built as a mask and then coloured as though it
 * were artwork, which is the failure the lance used to work around by hand.
 */
function tileFor(artwork: CanvasImageSource | null, name: SpriteName): number | undefined {
  return artwork === null ? undefined : SPRITE_TILES[name];
}

/**
 * Copies one tile of artwork into its frame, or reports that there is none.
 *
 * Returning false rather than throwing is what lets a single sprite fall back
 * on its own: the shockwave ring has no tile in a dungeon tileset, so it keeps
 * its drawn outline while everything around it comes from the sheet.
 */
function blitTile(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource | null,
  name: SpriteName,
  frame: Frame,
): boolean {
  const tile = tileFor(artwork, name);
  // The null check is the compiler's rather than the logic's: `tileFor` has
  // already answered no when there is no sheet, but it cannot say so in a type.
  if (artwork === null || tile === undefined) return false;

  const origin = tileOrigin(tile);
  ctx.drawImage(
    artwork,
    origin.x,
    origin.y,
    TILE_SIZE,
    TILE_SIZE,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
  );
  return true;
}

/** The layout in the shape Pixi's spritesheet parser expects. */
function toSpritesheetData(layout: AtlasLayout): SpritesheetData {
  const frames: Record<string, SpritesheetFrameData> = {};

  for (const [name, frame] of Object.entries(layout.frames)) {
    frames[name] = {
      frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
      sourceSize: { w: frame.w, h: frame.h },
      spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
    };
  }

  return { frames, meta: { scale: 1 } };
}

/** The fallback: one canvas per shape, which is what this project used before. */
function separateSprites(): Record<SpriteName, Texture> {
  const textures: Partial<Record<SpriteName, Texture>> = {};

  for (const spec of SPRITE_SPECS) {
    textures[spec.name] = Texture.from(
      drawToCanvas(spec.width ?? spec.size, spec.size, SPRITE_DRAWERS[spec.name]),
    );
  }

  return collect((name) => textures[name]);
}

/**
 * Turns a lookup into a complete set, failing loudly on a missing frame.
 *
 * Without this a typo in the atlas data would surface as an invisible entity
 * mid-run rather than as an error at startup.
 */
function collect(lookup: (name: SpriteName) => Texture | undefined): Record<SpriteName, Texture> {
  const textures = {} as Record<SpriteName, Texture>;

  for (const spec of SPRITE_SPECS) {
    const texture = lookup(spec.name);
    if (texture === undefined) throw new Error(`Sprite "${spec.name}" is missing from the atlas`);
    textures[spec.name] = texture;
  }

  return textures;
}

function drawGrid(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#0f1118';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#171b26';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
}

function drawToCanvas(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  draw(context(canvas), width, height);
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context is unavailable');
  return ctx;
}
