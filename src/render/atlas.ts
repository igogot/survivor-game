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
  /** The side in pixels, and the height of a frame that `width` widens. */
  readonly size: number;
  /**
   * Width, for the one frame that is not square.
   *
   * The lance is stretched to the reach of the thrust that landed, so a square
   * frame reached the screen at two fifths of its height and two to five times
   * its width — every edge in it arrived as a gradient, which is why the weapon
   * looked like a smear rather than a spear. Drawn at the proportions it is
   * shown at, the same shape lands between 0.7x and 1.6x instead.
   */
  readonly width?: number;
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

/**
 * Every drawer is handed both sides of its frame. Square frames pass the same
 * number twice, which is why all but the lance can go on ignoring the second.
 */
type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const WHITE = '#ffffff';

/**
 * The ember, drawn as pixels instead of as a curve.
 *
 * Everything else on screen is 16px pixel art blown up four times, and a
 * smooth polar outline sat against it as the one thing in the game with no
 * pixels in it. These are the same 16 by 16 the sheet's tiles are, so the fire
 * is made of the same size of pixel as the crab standing in it.
 *
 * `#` is the hot middle and `+` the cooler edge — the tileset outlines every
 * sprite in a darker shade of itself, and a mask can do the same by painting
 * the rim at part alpha. `.` is nothing.
 *
 * Four frames, cycled by the renderer. A patch of fire that holds still is a
 * stain, which is what one frame always looked like however it was shaped.
 */
const EMBER_GRID = 16;

/** How much of the tint the cooler rim keeps. */
const EMBER_DIM = 0.55;

const EMBER_PIXELS: readonly (readonly string[])[] = [
  [
    '................',
    '................',
    '...+++..+++.....',
    '..++++++++++....',
    '..++###+###+....',
    '...+#######+....',
    '...+########+++.',
    '..++#########++.',
    '..+##########++.',
    '..++########+++.',
    '...++######+....',
    '....+###+##++...',
    '....++##++++....',
    '....++++..+.....',
    '.....++.........',
    '................',
  ],
  [
    '................',
    '................',
    '.....+++...+....',
    '.....+#+++++++..',
    '.....+##+###++..',
    '.+++++######++..',
    '.++#########+...',
    '.++########++...',
    '..++########++..',
    '...+########++..',
    '...+######++++..',
    '...++#+####.....',
    '...+++.+##++....',
    '.......++++.....',
    '........+++.....',
    '................',
  ],
  [
    '................',
    '.......+++......',
    '.......++++.....',
    '....+.+###+.....',
    '...++++###+++...',
    '..++########++..',
    '...+#########+..',
    '...++#######++..',
    '..+########++...',
    '.++#########++..',
    '.++#########++..',
    '..++++###+##++..',
    '.....++#++++++..',
    '......+++.......',
    '.......+........',
    '................',
  ],
  [
    '................',
    '................',
    '...++++..+++....',
    '...++##+++++....',
    '...++######++...',
    '....+######+++..',
    '..+++########++.',
    '..+##########++.',
    '..+##########++.',
    '..++########++..',
    '...++######+....',
    '....+######+....',
    '...++##+++++....',
    '....+++..+++....',
    '.....+..........',
    '................',
  ],
];

/**
 * The frames of the flicker, in the order they are shown.
 *
 * Exported so the renderer cycles the list the atlas actually built rather than
 * a second list that could fall out of step with it.
 */
export const EMBER_FRAMES: readonly SpriteName[] = ['ember', 'ember2', 'ember3', 'ember4'];

/**
 * Which cells a frame may light.
 *
 * A patch burns its full radius and this project's rule is that a weapon hits
 * where it is drawn, so the fire may never reach past the circle it burns. On
 * a pixel grid that has to be measured to the corner of a cell and not to its
 * middle: a lit cell is a square of paint, and half of it hanging outside the
 * circle is paint outside the circle. `tests/atlas.test.ts` holds every frame
 * to this, because a frame is pixels and pixels have no test of their own.
 */
export function emberCellFits(col: number, row: number): boolean {
  const middle = EMBER_GRID / 2;
  let farthest = 0;
  for (const x of [col, col + 1]) {
    for (const y of [row, row + 1]) {
      farthest = Math.max(farthest, Math.hypot(x - middle, y - middle));
    }
  }
  return farthest <= middle;
}

/** The frames as the tests read them: one string per row, top to bottom. */
export function emberFramePixels(index: number): readonly string[] {
  return EMBER_PIXELS[index] ?? [];
}

export { EMBER_GRID };

function paintEmber(ctx: CanvasRenderingContext2D, size: number, index: number): void {
  const frame = EMBER_PIXELS[index];
  const cell = size / EMBER_GRID;

  ctx.save();
  ctx.fillStyle = WHITE;
  for (let row = 0; row < EMBER_GRID; row++) {
    const line = frame[row];
    for (let col = 0; col < EMBER_GRID; col++) {
      const mark = line[col];
      if (mark === '.') continue;
      ctx.globalAlpha = mark === '#' ? 1 : EMBER_DIM;
      // Whole cells, so the frame scales up with hard edges rather than a
      // gradient — the thing that makes it read as pixel art at all.
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  ctx.restore();
}

/**
 * Regular polygon, first vertex pointing up.
 */
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
      const tip = size * 0.2;
      const base = size * 0.74;
      const half = size * 0.17;
      // The tip leans off the vertical. A symmetric point over a round belly is
      // a raindrop, which is what the first version of this drew.
      const lean = size * 0.05;

      ctx.beginPath();
      ctx.moveTo(mid + lean, tip);
      ctx.quadraticCurveTo(mid + half * 1.35, size * 0.46, mid + half, base - half * 0.5);
      // The wavy base: two licks with a notch bitten between them. This is the
      // part that tells a flame from a drop at the size a 64px frame is
      // actually shown at, which on the player is about a third of that.
      ctx.quadraticCurveTo(mid + half * 0.85, base, mid + half * 0.4, base - half * 0.3);
      ctx.quadraticCurveTo(mid + half * 0.1, base + half * 0.55, mid - half * 0.25, base - half * 0.25);
      ctx.quadraticCurveTo(mid - half * 0.75, base + half * 0.3, mid - half, base - half * 0.75);
      // Up the left flank, hollowed rather than bulged, so the tongue curls
      // back toward the tip instead of closing a leaf around it.
      ctx.quadraticCurveTo(mid - half * 1.15, size * 0.4, mid + lean, tip);
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
   * A barbed spike on a haft, pointing up the axis the renderer rotates from.
   *
   * Drawn rather than cut from the sheet, and that is the whole point of it.
   * The tileset has no harpoon; the two things in it that come closest are a
   * dagger and a spike on a haft, and the bolt already is the dagger. Both are
   * grey on brown, and at the size a shot is actually seen — ten pixels
   * against eighteen — they read as one weapon fired at two strengths. A drawn
   * frame is a white mask, so it takes the weapon's own colour instead of the
   * tileset's, and colour is what separates two small shapes across a screen.
   *
   * Stubby barbs rather than swept ones: a swept barb is a sliver by the time
   * it reaches the point, and at a 32px frame it came apart into loose pixels.
   * These are short enough to stay solid and still say barb.
   */
  harpoon: (ctx, size) => {
    const mid = size / 2;

    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid + size * 0.25, size * 0.34);
    ctx.lineTo(mid - size * 0.25, size * 0.34);
    ctx.closePath();
    ctx.fill();

    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(mid + side * size * 0.11, size * 0.24);
      ctx.lineTo(mid + side * size * 0.46, size * 0.46);
      ctx.lineTo(mid + side * size * 0.3, size * 0.52);
      ctx.lineTo(mid + side * size * 0.11, size * 0.42);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillRect(mid - size * 0.11, size * 0.28, size * 0.22, size * 0.72);
  },

  orb: (ctx, size) => {
    ctx.fillStyle = WHITE;
    polygon(ctx, size, 4, 2);
  },

  /**
   * A lance pointing right, drawn on a frame as long as a lance is.
   *
   * Every other frame is scaled uniformly; this one is squeezed to the length
   * and width of the thrust that just landed, so what is drawn here are the
   * proportions of the box the lance fills. The frame is six times wider than
   * it is tall because that box is, and that is what lets the shape survive
   * the squeeze — it used to be a square arrow blown up along one axis, and it
   * showed.
   *
   * Everything is a fraction of the frame, so reach lengthens a spear rather
   * than a plank: blade, collar, two bindings and a butt cap all keep their
   * share of it. The bindings are what stop a fully bought lance, three
   * hundred pixels of it, from reading as a bar of colour.
   */
  spear: (ctx, width, height) => {
    const mid = height / 2;
    const haft = height * 0.2;
    const band = height * 0.32;
    const collar = width * 0.77;

    ctx.fillStyle = WHITE;
    // The haft starts at the player's own centre, because that is where the
    // frame starts: the box runs from the player to the reach of the thrust.
    ctx.fillRect(0, mid - haft, collar + width * 0.03, haft * 2);
    ctx.fillRect(0, mid - band, width * 0.035, band * 2);
    ctx.fillRect(width * 0.26, mid - band, width * 0.03, band * 2);
    ctx.fillRect(width * 0.4, mid - band, width * 0.03, band * 2);
    ctx.fillRect(collar, mid - height * 0.34, width * 0.025, height * 0.68);

    ctx.beginPath();
    ctx.moveTo(width * 0.795, mid - height * 0.19);
    ctx.lineTo(width * 0.85, mid - height * 0.42);
    ctx.lineTo(width - 1, mid);
    ctx.lineTo(width * 0.85, mid + height * 0.42);
    ctx.lineTo(width * 0.795, mid + height * 0.19);
    ctx.closePath();
    ctx.fill();
  },

  /**
   * One patch of burning ground: tongues licking outward from a hot middle.
   *
   * A trail is a few dozen of these laid along the player's path and stacked at
   * four tenths alpha, so what has to read as fire is the ribbon, not the
   * patch. This used to be a disc with a gentle seven-lobed wobble, and a
   * gentle wobble is exactly what a stain looks like — smooth, closed, the same
   * width all the way round. Tongues of uneven length and spacing are what say
   * burning instead of spilt.
   *
   * The renderer turns each patch by its own position, so the shape has to hold
   * up at every angle. That rules out a flame with a tip, which would point a
   * different way in each patch and none of them upward. A rosette has no tip
   * to point wrongly.
   *
   * What the patch damages is its full radius, and this project's rule is that
   * a weapon hits where it is drawn — so the outline only ever goes inward. The
   * crests land exactly on the radius and never a pixel past it; the deepest
   * notches sit at a little over half of it. `tests/atlas.test.ts` holds both
   * ends, because a frame is pixels and pixels have no test of their own. On a ribbon those troughs are covered by
   * the neighbouring patches, which sit three quarters of a radius away; the
   * only exposed rim in the game is the newest patch, under the player's feet.
   */
  ember: (ctx, size) => paintEmber(ctx, size, 0),
  ember2: (ctx, size) => paintEmber(ctx, size, 1),
  ember3: (ctx, size) => paintEmber(ctx, size, 2),
  ember4: (ctx, size) => paintEmber(ctx, size, 3),

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

  /*
   * A box, its lid seam, and the latch holding the two together.
   *
   * The seam is cut out and the latch drawn back over it, rather than the
   * latch being drawn on top of an unbroken box: a mask has one colour, so the
   * only way to show a line is to remove it, and the only way to interrupt
   * that line is to put the mask back.
   */
  chest: (ctx, size) => {
    const inset = size * 0.13;
    const width = size - inset * 2;
    const top = size * 0.2;

    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.roundRect(inset, top, width, size - top - inset, size * 0.1);
    ctx.fill();

    carve(ctx, () => ctx.fillRect(inset, size * 0.46, width, size * 0.07));
    ctx.fillRect(size / 2 - size * 0.08, size * 0.38, size * 0.16, size * 0.24);
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
  { name: 'spear', size: 32, width: 192 },
  { name: 'ember', size: 64 },
  { name: 'ember2', size: 64 },
  { name: 'ember3', size: 64 },
  { name: 'ember4', size: 64 },
  { name: 'gem', size: 32 },
  { name: 'gemRich', size: 32 },
  { name: 'chest', size: 48 },
  { name: 'ring', size: 96 },
];

/**
 * Shelf packing: frames are laid left to right in rows, tallest first, and a
 * new row starts when the next frame would overrun the width.
 *
 * Deliberately simple. The atlas holds twenty-three frames and is built once at
 * startup, so a smarter packer would buy nothing and cost a bug surface. It is
 * a pure function of its input, which is what makes the overlap test possible.
 *
 * Sorted by height, because that is what a shelf is: a frame wider than it is
 * tall changes which shelf still has room, never how tall the shelf is.
 */
export function packFrames(specs: readonly FrameSpec[]): AtlasLayout {
  const ordered = [...specs].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

  const frames: Record<string, Frame> = {};
  let x = PADDING;
  let y = PADDING;
  let shelfHeight = 0;
  let width = 0;

  for (const spec of ordered) {
    const frameWidth = spec.width ?? spec.size;
    if (x > PADDING && x + frameWidth + PADDING > MAX_WIDTH) {
      x = PADDING;
      y += shelfHeight + PADDING;
      shelfHeight = 0;
    }

    frames[spec.name] = { x, y, w: frameWidth, h: spec.size };

    x += frameWidth + PADDING;
    shelfHeight = Math.max(shelfHeight, spec.size);
    width = Math.max(width, x);
  }

  return { width, height: y + shelfHeight + PADDING, frames };
}
