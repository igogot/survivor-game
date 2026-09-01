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

import { TAU } from '../core/math';
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
 * A star with `points` points, first one up.
 *
 * Shared by the spark, the boss and the emblem cut into one of the players —
 * three shapes that were the same loop written three times.
 */
function star(
  ctx: CanvasRenderingContext2D,
  centre: number,
  outer: number,
  inner: number,
  points: number,
): void {
  const vertices = points * 2;
  ctx.beginPath();
  for (let i = 0; i < vertices; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * TAU) / vertices;
    const x = centre + Math.cos(angle) * radius;
    const y = centre + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * The body all three players share: blocky and deliberate, the one thing on
 * screen under the player's control.
 */
function playerBody(ctx: CanvasRenderingContext2D, size: number): void {
  const inset = 3;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.28);
  ctx.fill();
}

/**
 * Cuts a shape out of what has already been drawn.
 *
 * The players differ by the emblem removed from the shared body rather than by
 * a mark drawn on top of it, because a mask has exactly one colour: anything
 * drawn over the body would vanish the moment the sprite was tinted, which is
 * how the damage flash and every enemy variant are coloured.
 */
function carve(ctx: CanvasRenderingContext2D, cut: () => void): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  cut();
  ctx.restore();
}

/**
 * Silhouettes, not just tints.
 *
 * A crowd of six hundred is read at a glance by shape long before colour, so
 * the three enemy types differ in outline: a runner should look quick standing
 * still, and a brute should look like it takes a while to kill.
 */
export const SPRITE_DRAWERS: Readonly<Record<SpriteName, Draw>> = {
  // The spark the weapon fires, worn as a badge.
  playerBolt: (ctx, size) => {
    playerBody(ctx, size);
    carve(ctx, () => star(ctx, size / 2, size * 0.3, size * 0.1, 4));
  },

  // Four blades around a centre: the ring the weapon keeps, at rest.
  playerOrbit: (ctx, size) => {
    playerBody(ctx, size);
    carve(ctx, () => {
      for (let i = 0; i < 4; i++) {
        const angle = (i * TAU) / 4;
        ctx.beginPath();
        ctx.arc(
          size / 2 + Math.cos(angle) * size * 0.26,
          size / 2 + Math.sin(angle) * size * 0.26,
          size * 0.085,
          0,
          TAU,
        );
        ctx.fill();
      }
    });
  },

  // The wave itself: a ring leaving the middle.
  playerNova: (ctx, size) => {
    playerBody(ctx, size);
    carve(ctx, () => {
      ctx.lineWidth = size * 0.09;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.27, 0, TAU);
      ctx.stroke();
    });
  },

  // The lance itself, laid across the chest: the emblem is the weapon, the same
  // way the bolt wears its spark and the shockwave its ring.
  playerSpear: (ctx, size) => {
    playerBody(ctx, size);
    carve(ctx, () => {
      const mid = size / 2;
      const half = size * 0.26;
      const shaft = size * 0.055;
      ctx.beginPath();
      ctx.moveTo(mid - half, mid - shaft);
      ctx.lineTo(mid + half * 0.4, mid - shaft);
      ctx.lineTo(mid + half * 0.4, mid - shaft * 2.4);
      ctx.lineTo(mid + half, mid);
      ctx.lineTo(mid + half * 0.4, mid + shaft * 2.4);
      ctx.lineTo(mid + half * 0.4, mid + shaft);
      ctx.lineTo(mid - half, mid + shaft);
      ctx.closePath();
      ctx.fill();
    });
  },

  // The spike, laid the same way the lance is, and told apart from it by the
  // guard — which is the same thing that tells the two weapons apart on screen.
  playerHarpoon: (ctx, size) => {
    playerBody(ctx, size);
    carve(ctx, () => {
      const mid = size / 2;
      const half = size * 0.27;
      const headHalf = size * 0.1;
      const shaft = size * 0.042;
      const barHalf = size * 0.105;
      const barWidth = size * 0.045;
      const bar = mid - half * 0.25;

      ctx.beginPath();
      ctx.moveTo(mid + half, mid);
      ctx.lineTo(mid + half * 0.3, mid - headHalf);
      ctx.lineTo(mid + half * 0.3, mid + headHalf);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(mid - half, mid - shaft, half * 1.35, shaft * 2);
      ctx.fillRect(bar - barWidth / 2, mid - barHalf, barWidth, barHalf * 2);
    });
  },

  // A tongue of flame, cut the same way the other emblems are. The one player
  // whose weapon is not carried but left behind, so the badge is the fire
  // rather than the thing that makes it.
  playerEmber: (ctx, size) => {
    playerBody(ctx, size);
    carve(ctx, () => {
      const mid = size / 2;
      const top = size * 0.24;
      const base = size * 0.74;
      const half = size * 0.17;

      // A leaf with a curled tip: two curves meeting at a point above and a
      // rounded belly below, which is the shortest shape that still reads as
      // fire at a 24px figure.
      ctx.beginPath();
      ctx.moveTo(mid, top);
      ctx.quadraticCurveTo(mid + half * 1.5, size * 0.5, mid + half, base - half);
      ctx.quadraticCurveTo(mid, base + half * 0.6, mid - half, base - half);
      ctx.quadraticCurveTo(mid - half * 1.5, size * 0.5, mid, top);
      ctx.closePath();
      ctx.fill();
    });
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

  // A ring around a core, so it reads as charged rather than as another body.
  // The player has to recognise this one before it is next to them.
  bomber: (ctx, size) => {
    const centre = size / 2;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(centre, centre, size * 0.22, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.beginPath();
    ctx.arc(centre, centre, size * 0.38, 0, Math.PI * 2);
    ctx.stroke();
  },

  // A hooded wedge: narrow at the top, wide at the base, so it reads as
  // standing still and doing something rather than walking at you.
  caster: (ctx, size) => {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(size / 2, 3);
    ctx.lineTo(size - 5, size - 6);
    ctx.lineTo(5, size - 6);
    ctx.closePath();
    ctx.fill();
  },

  // A small ring rather than a solid dot: the one projectile the player must
  // read as incoming, so it must not look like their own bolt.
  hex: (ctx, size) => {
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
  },

  // Spiked, so it never reads as a scaled-up brute.
  boss: (ctx, size) => {
    const outer = size / 2 - 2;
    ctx.fillStyle = WHITE;
    star(ctx, size / 2, outer, outer * 0.62, 8);
  },

  // A four-pointed spark, drawn to read right at every angle.
  bolt: (ctx, size) => {
    const outer = size / 2 - 2;
    ctx.fillStyle = WHITE;
    star(ctx, size / 2, outer, outer * 0.34, 4);
  },

  /**
   * A spike on a hafted shaft with a guard, pointing up the same axis the
   * sheet's tile does, so the renderer's one rotation serves both.
   *
   * Solid on purpose. Swept barbs were the obvious drawing and they came apart
   * into loose pixels at a 32px frame — the diagonal that makes a barb a barb
   * is a sliver by the time it reaches the point. The crossbar carries the same
   * reading and survives the resolution.
   */
  harpoon: (ctx, size) => {
    const mid = size / 2;
    const head = size * 0.4;
    const headHalf = size * 0.25;
    const haftHalf = size * 0.06;
    const barHalf = size * 0.22;

    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(mid, 1);
    ctx.lineTo(mid + headHalf, head);
    ctx.lineTo(mid - headHalf, head);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(mid - haftHalf, head - 1, haftHalf * 2, size - head);
    ctx.fillRect(mid - barHalf, size * 0.5, barHalf * 2, size * 0.09);
  },

  orb: (ctx, size) => {
    ctx.fillStyle = WHITE;
    polygon(ctx, size, 4, 2);
  },

  /**
   * A lance pointing right, drawn to be stretched.
   *
   * Every other frame is scaled uniformly; this one is squeezed to the length
   * and width of the thrust that just landed, so what is drawn here are the
   * proportions of the box the lance fills, not of a lance. The head keeps its
   * share of that box at any reach, which is what stops a long thrust from
   * reading as a plank.
   */
  spear: (ctx, size) => {
    const mid = size / 2;
    const shaft = size * 0.42;
    const neck = size * 0.76;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(0, mid - shaft / 2);
    ctx.lineTo(neck, mid - shaft / 2);
    ctx.lineTo(neck, 1);
    ctx.lineTo(size - 1, mid);
    ctx.lineTo(neck, size - 1);
    ctx.lineTo(neck, mid + shaft / 2);
    ctx.lineTo(0, mid + shaft / 2);
    ctx.closePath();
    ctx.fill();
  },

  /**
   * One patch of burning ground.
   *
   * A disc with a wobbling edge rather than a clean circle: a trail is a few
   * dozen of these laid along the player's path, and identical circles read as
   * a row of dots instead of as fire. The renderer turns each patch by its own
   * position so the wobble never lines up between neighbours.
   *
   * The wobble is deliberately small. What the patch damages is its full
   * radius, and this project's rule is that a weapon hits where it is drawn —
   * so the edge is allowed to breathe by a tenth and no more.
   */
  ember: (ctx, size) => {
    const centre = size / 2;
    const outer = size / 2 - 1;
    const lobes = 7;
    const steps = 96;

    ctx.fillStyle = WHITE;
    ctx.beginPath();
    for (let i = 0; i < steps; i++) {
      const angle = (i * TAU) / steps;
      const radius = outer * (0.9 + 0.1 * Math.cos(lobes * angle));
      const x = centre + Math.cos(angle) * radius;
      const y = centre + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
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
  { name: 'playerBolt', size: 64 },
  { name: 'playerOrbit', size: 64 },
  { name: 'playerNova', size: 64 },
  { name: 'playerSpear', size: 64 },
  { name: 'playerHarpoon', size: 64 },
  { name: 'playerEmber', size: 64 },
  { name: 'grunt', size: 64 },
  { name: 'runner', size: 64 },
  { name: 'brute', size: 64 },
  { name: 'splitter', size: 64 },
  { name: 'spawnling', size: 32 },
  { name: 'caster', size: 64 },
  { name: 'bomber', size: 64 },
  { name: 'hex', size: 32 },
  { name: 'boss', size: 96 },
  { name: 'bolt', size: 32 },
  { name: 'harpoon', size: 32 },
  { name: 'orb', size: 32 },
  { name: 'spear', size: 64 },
  { name: 'ember', size: 64 },
  { name: 'gem', size: 32 },
  { name: 'gemRich', size: 32 },
  { name: 'ring', size: 96 },
];

/**
 * Shelf packing: frames are laid left to right in rows, tallest first, and a
 * new row starts when the next frame would overrun the width.
 *
 * Deliberately simple. The atlas holds a couple of dozen frames and is built once at
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
