/**
 * The sprite atlas: one canvas holding every entity shape, plus the packing
 * that decides where each one sits.
 *
 * Why an atlas at all — a single source texture is what lets Pixi batch the
 * whole scene into a couple of draw calls no matter how many enemies are alive.
 * Individual textures per entity would make draw calls scale with the number of
 * distinct sprites, which is exactly the property this project is built to show
 * off. Real artwork should replace the drawing functions below and keep the
 * packing; nothing outside this file needs to know the difference.
 *
 * Everything is drawn white on purpose. Tint is load-bearing — it carries the
 * damage flash and tells enemy variants apart — and tinting only reads as the
 * intended colour on a white mask. Full-colour artwork would have to bring its
 * own answer for both, so the mask convention is a deliberate constraint rather
 * than a placeholder detail.
 */

import type { SpriteName } from '../data/sprites';

export interface FrameSpec {
  readonly name: SpriteName;
  /** Frames are square; this is the side in pixels. */
  readonly size: number;
}

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AtlasLayout {
  readonly width: number;
  readonly height: number;
  readonly frames: Readonly<Record<string, Frame>>;
}

/** Transparent gutter between frames, so filtering cannot bleed one into the next. */
const PADDING = 2;
const MAX_WIDTH = 256;

type Draw = (ctx: CanvasRenderingContext2D, size: number) => void;

const WHITE = '#ffffff';

/** Regular polygon, first vertex pointing up. */
function polygon(ctx: CanvasRenderingContext2D, size: number, sides: number, inset: number): void {
  const radius = size / 2 - inset;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    const x = size / 2 + Math.cos(angle) * radius;
    const y = size / 2 + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Silhouettes, not just tints.
 *
 * A crowd of six hundred is read at a glance by shape long before colour, so
 * the three enemy types differ in outline: a runner should look quick standing
 * still, and a brute should look like it takes a while to kill.
 */
export const SPRITE_DRAWERS: Readonly<Record<SpriteName, Draw>> = {
  // Blocky and deliberate — the one thing on screen under the player's control.
  player: (ctx, size) => {
    const inset = 3;
    const radius = size * 0.28;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
    ctx.fill();
  },

  grunt: (ctx, size) => {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  },

  // A chevron: all of its mass is at the front, which reads as speed.
  runner: (ctx, size) => {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(size / 2, 2);
    ctx.lineTo(size - 3, size - 4);
    ctx.lineTo(size / 2, size * 0.72);
    ctx.lineTo(3, size - 4);
    ctx.closePath();
    ctx.fill();
  },

  brute: (ctx, size) => {
    ctx.fillStyle = WHITE;
    polygon(ctx, size, 6, 2);
  },

  // Two fused lobes, so it reads as something already made of parts before it
  // is hit — the split should look inevitable rather than surprising.
  splitter: (ctx, size) => {
    const radius = size * 0.29;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(size * 0.36, size * 0.44, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(size * 0.64, size * 0.58, radius, 0, Math.PI * 2);
    ctx.fill();
  },

  // A droplet: pointed at the top so a fragment never reads as a small grunt.
  spawnling: (ctx, size) => {
    const centre = size / 2;
    const radius = size * 0.3;
    const belly = centre + radius * 0.5;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(centre, 2);
    ctx.lineTo(centre + radius, belly);
    ctx.arc(centre, belly, radius, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  },

  // Spiked, so it never reads as a scaled-up brute.
  boss: (ctx, size) => {
    const centre = size / 2;
    const outer = size / 2 - 2;
    const inner = outer * 0.62;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (i * Math.PI) / 8;
      const x = centre + Math.cos(angle) * radius;
      const y = centre + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },

  // A four-pointed spark. Projectiles are drawn without rotation, so the shape
  // has to look right at every angle.
  bolt: (ctx, size) => {
    const centre = size / 2;
    const outer = size / 2 - 2;
    const inner = outer * 0.34;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (i * Math.PI) / 4;
      const x = centre + Math.cos(angle) * radius;
      const y = centre + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },

  orb: (ctx, size) => {
    ctx.fillStyle = WHITE;
    polygon(ctx, size, 4, 2);
  },

  gem: (ctx, size) => {
    ctx.fillStyle = WHITE;
    polygon(ctx, size, 4, 2);
  },

  // The richer pickup differs in outline, not in tint, so it stays legible
  // whichever art is in use.
  gemRich: (ctx, size) => {
    ctx.fillStyle = WHITE;
    polygon(ctx, size, 6, 2);
  },

  // Stroked just inside the frame, so scaling the sprite to `radius * 2` puts
  // the outer edge of the stroke exactly on the shockwave's radius.
  ring: (ctx, size) => {
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
  },
};

export const SPRITE_SPECS: readonly FrameSpec[] = [
  { name: 'player', size: 64 },
  { name: 'grunt', size: 64 },
  { name: 'runner', size: 64 },
  { name: 'brute', size: 64 },
  { name: 'splitter', size: 64 },
  { name: 'spawnling', size: 32 },
  { name: 'boss', size: 96 },
  { name: 'bolt', size: 32 },
  { name: 'orb', size: 32 },
  { name: 'gem', size: 32 },
  { name: 'gemRich', size: 32 },
  { name: 'ring', size: 96 },
];

/**
 * Shelf packing: frames are laid left to right in rows, tallest first, and a
 * new row starts when the next frame would overrun the width.
 *
 * Deliberately simple. The atlas holds nine frames and is built once at
 * startup, so a smarter packer would buy nothing and cost a bug surface. It is
 * a pure function of its input, which is what makes the overlap test possible.
 */
export function packFrames(specs: readonly FrameSpec[]): AtlasLayout {
  const ordered = [...specs].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

  const frames: Record<string, Frame> = {};
  let x = PADDING;
  let y = PADDING;
  let shelfHeight = 0;
  let width = 0;

  for (const spec of ordered) {
    if (x > PADDING && x + spec.size + PADDING > MAX_WIDTH) {
      x = PADDING;
      y += shelfHeight + PADDING;
      shelfHeight = 0;
    }

    frames[spec.name] = { x, y, w: spec.size, h: spec.size };

    x += spec.size + PADDING;
    shelfHeight = Math.max(shelfHeight, spec.size);
    width = Math.max(width, x);
  }

  return { width, height: y + shelfHeight + PADDING, frames };
}
