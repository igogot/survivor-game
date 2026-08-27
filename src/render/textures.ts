import { Texture } from 'pixi.js';

export const CIRCLE_TEXTURE_SIZE = 64;
export const GEM_TEXTURE_SIZE = 32;
export const GRID_TEXTURE_SIZE = 64;
export const RING_TEXTURE_SIZE = 96;

export interface TextureSet {
  readonly circle: Texture;
  readonly gem: Texture;
  readonly grid: Texture;
  readonly ring: Texture;
}

/**
 * Placeholder art, drawn once into offscreen canvases at startup.
 *
 * Everything is white and tinted per sprite, so the whole scene shares a single
 * texture and batches into a couple of draw calls no matter how many enemies
 * are on screen. Swapping in a real sprite sheet later only touches this file.
 */
export function createTextures(): TextureSet {
  const circle = Texture.from(
    drawToCanvas(CIRCLE_TEXTURE_SIZE, (ctx, size) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
    }),
  );

  const gem = Texture.from(
    drawToCanvas(GEM_TEXTURE_SIZE, (ctx, size) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(size / 2, 2);
      ctx.lineTo(size - 2, size / 2);
      ctx.lineTo(size / 2, size - 2);
      ctx.lineTo(2, size / 2);
      ctx.closePath();
      ctx.fill();
    }),
  );

  const grid = Texture.from(
    drawToCanvas(GRID_TEXTURE_SIZE, (ctx, size) => {
      ctx.fillStyle = '#0f1118';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#171b26';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, size, size);
    }),
  );

  // Stroked just inside the canvas edge, so scaling the sprite to `radius * 2`
  // puts the outer edge of the stroke exactly on the shockwave's radius.
  const ring = Texture.from(
    drawToCanvas(RING_TEXTURE_SIZE, (ctx, size) => {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
      ctx.stroke();
    }),
  );

  return { circle, gem, grid, ring };
}

function drawToCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas context is unavailable');

  draw(ctx, size);
  return canvas;
}
