import { Spritesheet, Texture } from 'pixi.js';
import type { SpritesheetData, SpritesheetFrameData } from 'pixi.js';
import { SPRITE_DRAWERS, SPRITE_SPECS, packFrames } from './atlas';
import {
  FLOOR_TILES,
  PAVING_TILES,
  PILLAR_CAPITAL,
  PILLAR_SHAFT,
  PROP_TILES,
  RUBBLE_TILES,
  SPRITE_TILES,
  WALL_TILES,
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
 * units across — a little wider than the player. A whole multiple of the source
 * on purpose: the pixels double instead of being interpolated, which is what
 * keeps the ground as sharp as what stands on it.
 */
const FLOOR_TILE_SIZE = 32;

/**
 * Cells along one side of the repeating patch.
 *
 * Thirty-two stones is 1024px, and the patch is what a TilingSprite repeats,
 * so that is the distance before the ground says the same thing twice. The
 * first attempt used twelve, which was defensible when the floor was gravel
 * and indefensible the moment it held buildings: a wall you recognise, seen
 * three times across one screen, is worse than no wall at all.
 */
const FLOOR_PATCH_TILES = 32;

/**
 * How the ground is dimmed once it is laid.
 *
 * Down to about half. The sheet's sand was drawn for a lit room and everything
 * this game puts on top of it has to be found in a crowd, so the floor has to
 * give way — but the first attempt took three quarters of the light out, and
 * what came back was mud with the texture gone. Half is where the stone still
 * has colour and the horde still wins the contrast.
 */
const FLOOR_SHADE = 'rgba(10, 12, 20, 0.48)';

/**
 * Painted under the tiles, in case one lets the canvas through.
 *
 * Keying the backing colour out is a comparison against one exact colour, and
 * nothing guarantees a stray pixel of floor art is not that colour. Dark earth
 * underneath means such a pixel reads as a gap between stones rather than as a
 * hole into nothing.
 */
const FLOOR_BASE = '#3a2c20';

/** Buildings whose remains are laid into one patch. */
const RUIN_COUNT = 7;

/** Shortest and longest side of one of them, in cells. */
const RUIN_MIN_SIDE = 5;
const RUIN_MAX_SIDE = 10;

/**
 * How many places to try before giving up on a building.
 *
 * Buildings are not allowed to overlap or even to touch, so a placement can
 * fail, and a patch with six buildings in it is no worse than one with seven.
 * Giving up quietly is the right answer; growing the patch until everything
 * fits would make the repeat visible again.
 */
const RUIN_PLACEMENT_TRIES = 24;

/**
 * Breaches knocked through one building's walls, and the longest run of them.
 *
 * A breach is a contiguous stretch, never a single hole in a random place.
 * That distinction is the whole difference between a wall that has fallen down
 * somewhere and a wall drawn by a coin toss: the first has a shape, the second
 * is a dashed line. Corners are never breached, so the rectangle still reads
 * as a rectangle from across the screen.
 */
const RUIN_MAX_BREACHES = 3;
const BREACH_MAX_RUN = 3;

/** Chances of loose stone: at the foot of a wall, and out in the open. */
const RUBBLE_AT_WALL = 4;
const RUBBLE_IN_OPEN = 29;

/** One crate or barrel per this many cells that have a wall to stand against. */
const PROP_RARITY = 9;

/** One standing column per this many paved cells. */
const PILLAR_RARITY = 31;

/**
 * What one cell of the plan holds.
 *
 * Open ground has no name here on purpose: it is zero, which is what an
 * untouched cell of the plan already is, so nothing has to write it.
 */
const WALL = 1;
const PAVED = 2;
const BREACH = 3;

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
 * Lays one patch of ruined ground for the background to repeat.
 *
 * Built once at startup and handed to a single TilingSprite, so the whole
 * ground under the run stays one draw call however far the player walks.
 *
 * The plan comes before the paint, and the plan is buildings: a room of cut
 * paving, masonry around it, breaches knocked through that masonry. Two rules
 * do most of the work of making them look built rather than assembled. A
 * building is made of **one** cut of masonry and **one** cut of paving, chosen
 * once for the whole building — five kinds of block shuffled along a wall is a
 * pile of blocks, not a wall. And buildings never overlap or touch, so each
 * rectangle is one thing with ground around it.
 *
 * Every decision is hashed from coordinates or from the building's own number
 * rather than drawn. The run's PRNG is the balance table's, and one extra draw
 * from the renderer would move every seed the stand has measured.
 *
 * Everything wraps by the patch width, so a wall running off one edge carries
 * on at the other and the patch tiles against itself.
 */
function drawFloor(artwork: CanvasImageSource): HTMLCanvasElement {
  const side = FLOOR_TILE_SIZE * FLOOR_PATCH_TILES;
  const plan = planRuins();

  return drawToCanvas(side, side, (ctx) => {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = FLOOR_BASE;
    ctx.fillRect(0, 0, side, side);

    // Ground first, all of it, before anything stands on it. Two passes rather
    // than one because a column is two cells tall: painting it in the same
    // sweep would put the next cell's floor over its capital.
    forEachCell((col, row, at) => {
      const owner = plan.owner[at];
      const tile =
        owner === 0
          ? pick(FLOOR_TILES, mix(col, row))
          : pick(PAVING_TILES, mix(owner, 17));

      blitFloorTile(ctx, artwork, tile, col, row);
    });

    forEachCell((col, row, at) => {
      const kind = plan.kind[at];

      // One cut of masonry for the whole building, keyed on which building it
      // is. This is the line that decides whether a wall reads as a wall.
      if (kind === WALL) {
        blitFloorTile(ctx, artwork, pick(WALL_TILES, mix(plan.owner[at], 29)), col, row);
        return;
      }

      const litter = mix(col + 101, row + 57);

      // A breach is where the wall came down, so that is where its stones are.
      if (kind === BREACH) {
        blitFloorTile(ctx, artwork, pick(RUBBLE_TILES, litter), col, row);
        return;
      }

      const sheltered = touchesWall(plan.kind, col, row);

      if (sheltered && litter % PROP_RARITY === 0) {
        blitFloorTile(ctx, artwork, pick(PROP_TILES, litter), col, row);
        return;
      }

      // Rubble gathers where something fell, which is against the walls. Out
      // in the open it is rare enough to read as one stone rather than as a
      // scattering, which is what made the field look like gravel.
      if (litter % (sheltered ? RUBBLE_AT_WALL : RUBBLE_IN_OPEN) === 0) {
        blitFloorTile(ctx, artwork, pick(RUBBLE_TILES, litter), col, row);
        return;
      }

      if (kind === PAVED && litter % PILLAR_RARITY === 0) {
        blitFloorTile(ctx, artwork, PILLAR_SHAFT, col, row);
        blitFloorTile(ctx, artwork, PILLAR_CAPITAL, col, row - 1);
      }
    });

    ctx.fillStyle = FLOOR_SHADE;
    ctx.fillRect(0, 0, side, side);
  });
}

/** The plan: what each cell is, and which building put it there. */
interface RuinPlan {
  readonly kind: Uint8Array;
  /** Building number plus one, so zero can mean open ground. */
  readonly owner: Uint8Array;
}

/**
 * Decides what every cell of the patch is before a pixel is drawn.
 *
 * Buildings are placed one at a time and refused if they would touch one
 * already standing — the earlier version let them overlap, on the theory that
 * a site built over twice is what an old site looks like. It is, and it also
 * turned every rectangle into a ragged shape sharing walls with its
 * neighbours, which is most of why the result read as random blocks. Clear
 * ground around each building is what lets the eye see one.
 */
function planRuins(): RuinPlan {
  const size = FLOOR_PATCH_TILES;
  const plan: RuinPlan = { kind: new Uint8Array(size * size), owner: new Uint8Array(size * size) };
  const span = RUIN_MAX_SIDE - RUIN_MIN_SIDE + 1;

  for (let k = 0; k < RUIN_COUNT; k++) {
    for (let attempt = 0; attempt < RUIN_PLACEMENT_TRIES; attempt++) {
      const seed = mix(k * 977 + 13, attempt * 31 + 7);
      const width = RUIN_MIN_SIDE + ((seed >>> 3) % span);
      const height = RUIN_MIN_SIDE + ((seed >>> 9) % span);
      const left = (seed >>> 15) % size;
      const top = (seed >>> 21) % size;

      if (!isClear(plan.owner, left, top, width, height)) continue;

      stampRuin(plan, k + 1, seed, left, top, width, height);
      break;
    }
  }

  return plan;
}

/**
 * Whether a building would fit here, with a cell of daylight all round it.
 *
 * The margin is the point: two buildings sharing a wall are one confusing
 * shape, and a gap of a single cell is enough for the eye to separate them.
 */
function isClear(
  owner: Uint8Array,
  left: number,
  top: number,
  width: number,
  height: number,
): boolean {
  const size = FLOOR_PATCH_TILES;

  for (let dy = -1; dy <= height; dy++) {
    for (let dx = -1; dx <= width; dx++) {
      const col = (((left + dx) % size) + size) % size;
      const row = (((top + dy) % size) + size) % size;
      if (owner[row * size + col] !== 0) return false;
    }
  }

  return true;
}

/** Writes one building into the plan, breaches and all. */
function stampRuin(
  plan: RuinPlan,
  owner: number,
  seed: number,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const size = FLOOR_PATCH_TILES;

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const col = (left + dx) % size;
      const row = (top + dy) % size;
      const at = row * size + col;
      const edge = dx === 0 || dy === 0 || dx === width - 1 || dy === height - 1;

      plan.owner[at] = owner;
      plan.kind[at] = edge ? WALL : PAVED;
    }
  }

  const perimeter = 2 * (width + height) - 4;
  const breaches = 1 + ((seed >>> 27) % RUIN_MAX_BREACHES);

  for (let b = 0; b < breaches; b++) {
    const bite = mix(owner * 613 + b * 97, 41);
    const start = bite % perimeter;
    const run = 1 + ((bite >>> 7) % BREACH_MAX_RUN);

    for (let i = 0; i < run; i++) {
      const step = walkPerimeter((start + i) % perimeter, width, height);
      // Corners hold the rectangle up. Knock one out and the shape stops
      // reading as a building from any distance at all.
      if (step.corner) continue;

      const col = (left + step.dx) % size;
      const row = (top + step.dy) % size;
      plan.kind[row * size + col] = BREACH;
    }
  }
}

/**
 * Turns a step count into a cell on the rectangle's border, clockwise from the
 * top-left, and says whether that cell is a corner.
 */
function walkPerimeter(
  step: number,
  width: number,
  height: number,
): { dx: number; dy: number; corner: boolean } {
  const top = width;
  const right = top + height - 1;
  const bottom = right + width - 1;

  let dx: number;
  let dy: number;

  if (step < top) {
    dx = step;
    dy = 0;
  } else if (step < right) {
    dx = width - 1;
    dy = step - top + 1;
  } else if (step < bottom) {
    dx = width - 1 - (step - right);
    dy = height - 1;
  } else {
    dx = 0;
    dy = height - 1 - (step - bottom);
  }

  const corner = (dx === 0 || dx === width - 1) && (dy === 0 || dy === height - 1);
  return { dx, dy, corner };
}

/** Whether any of the four neighbours is masonry. */
function touchesWall(kind: Uint8Array, col: number, row: number): boolean {
  const size = FLOOR_PATCH_TILES;
  const left = (col + size - 1) % size;
  const right = (col + 1) % size;
  const up = (row + size - 1) % size;
  const down = (row + 1) % size;

  return (
    kind[row * size + left] === WALL ||
    kind[row * size + right] === WALL ||
    kind[up * size + col] === WALL ||
    kind[down * size + col] === WALL
  );
}

/** Walks the patch once, in the order the cells are painted. */
function forEachCell(visit: (col: number, row: number, at: number) => void): void {
  const size = FLOOR_PATCH_TILES;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      visit(col, row, row * size + col);
    }
  }
}

/** Doubles one source tile onto the cell at `col`,`row`, wrapping the patch. */
function blitFloorTile(
  ctx: CanvasRenderingContext2D,
  artwork: CanvasImageSource,
  tile: number,
  col: number,
  row: number,
): void {
  const size = FLOOR_PATCH_TILES;
  const origin = tileOrigin(tile);

  ctx.drawImage(
    artwork,
    origin.x,
    origin.y,
    TILE_SIZE,
    TILE_SIZE,
    ((col % size) + size) % size * FLOOR_TILE_SIZE,
    ((row % size) + size) % size * FLOOR_TILE_SIZE,
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
