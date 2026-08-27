import { Spritesheet, Texture } from 'pixi.js';
import type { SpritesheetData, SpritesheetFrameData } from 'pixi.js';
import { SPRITE_DRAWERS, SPRITE_SPECS, packFrames } from './atlas';
import type { AtlasLayout } from './atlas';
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

  try {
    return { grid, sprites: await packedSprites(), packed: true };
  } catch (error) {
    // A game that renders nothing is worse than a game that renders slower, so
    // a broken atlas degrades to individual textures rather than a blank screen.
    console.warn('Sprite atlas unavailable; falling back to separate textures.', error);
    return { grid, sprites: separateSprites(), packed: false };
  }
}

async function packedSprites(): Promise<Record<SpriteName, Texture>> {
  const layout = packFrames(SPRITE_SPECS);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = context(canvas);

  for (const spec of SPRITE_SPECS) {
    const frame = layout.frames[spec.name];
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
