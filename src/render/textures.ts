import { Spritesheet, Texture } from 'pixi.js';
import type { SpritesheetData, SpritesheetFrameData } from 'pixi.js';
import { SPRITE_DRAWERS, SPRITE_SPECS, packFrames } from './atlas';
import { SPRITE_TILES, TILE_SIZE, loadSpriteSheet, stripTileBacking, tileOrigin } from './artwork';
import type { AtlasLayout, Frame } from './atlas';
import type { SpriteName } from '../data/sprites';

export const GRID_TEXTURE_SIZE = 64;

export interface TextureSet {
  /**
   * The background tile, deliberately outside the atlas: a TilingSprite repeats
   * its whole source texture, so a frame would drag its neighbours into every
   * tile.
   */
  readonly grid: Texture;
  readonly sprites: Readonly<Record<SpriteName, Texture>>;
  /** False when the atlas failed to build and the per-shape fallback is in use. */
  readonly packed: boolean;
  /**
   * True when the frames came from the artwork rather than from drawn shapes.
   *
   * The renderer needs to know: the shapes are white masks that tint into the
   * colour they should be, and tinting artwork the same way would only make it
   * darker. See how the damage flash is drawn.
   */
  readonly artwork: boolean;
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
  const grid = Texture.from(drawToCanvas(GRID_TEXTURE_SIZE, drawGrid));
  const sheet = await loadArtwork();

  try {
    return {
      grid,
      sprites: await packedSprites(sheet),
      packed: true,
      artwork: sheet !== null,
      paint: painter(sheet),
    };
  } catch (error) {
    // A game that renders nothing is worse than a game that renders slower, so
    // a broken atlas degrades to individual textures rather than a blank screen.
    console.warn('Sprite atlas unavailable; falling back to separate textures.', error);
    return {
      grid,
      sprites: separateSprites(),
      packed: false,
      artwork: false,
      paint: painter(null),
    };
  }
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
    SPRITE_DRAWERS[spec.name](ctx, spec.size);
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

    // The drawn shapes are square by construction, so they are given the
    // smaller side rather than being stretched to fill an oblong canvas.
    SPRITE_DRAWERS[name](ctx, Math.min(canvas.width, canvas.height));
  };
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
  if (artwork === null) return false;

  const tile = SPRITE_TILES[name];
  if (tile === undefined) return false;

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
      drawToCanvas(spec.size, (ctx, size) => SPRITE_DRAWERS[spec.name](ctx, size)),
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
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  draw(context(canvas), size);
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context is unavailable');
  return ctx;
}
