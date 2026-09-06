/**
 * The vocabulary of sprite names, owned by the game data rather than by the
 * renderer.
 *
 * An enemy definition says it looks like a `brute`; `src/render/atlas.ts`
 * decides what a brute looks like. Keeping the union here means the renderer
 * depends on the data and not the other way round, and the compiler still
 * refuses an enemy that names a frame nobody draws.
 */
export type SpriteName =
  /**
   * The player, one silhouette per weapon a run can open with.
   *
   * A run is played as the weapon that started it, so the figure on screen
   * says which one that was — the choice is visible for the whole run instead
   * of only on the screen where it was made. They share a body and differ by
   * the emblem cut out of it, so the player still reads as the player.
   */
  | 'playerBolt'
  | 'playerOrbit'
  | 'playerNova'
  | 'playerSpear'
  | 'playerHarpoon'
  | 'playerEmber'
  | 'grunt'
  | 'runner'
  | 'brute'
  /** Comes apart on death; see `EnemyDef.split`. */
  | 'splitter'
  /** What a splitter leaves behind. */
  | 'spawnling'
  /** Keeps its distance and throws instead of touching. */
  | 'caster'
  /** Costs something to kill: it goes off where it falls. */
  | 'bomber'
  /**
   * What a caster throws, and what a boss throws ten of at once.
   *
   * Drawn rather than cut from the sheet, which is the whole of its legibility:
   * tile 114 is a green flask and both gems are flasks too, so the one thing
   * the player has to see coming was the same rack of glassware as the two
   * things lying on the floor. See `SPRITE_TILES`.
   */
  | 'hex'
  | 'boss'
  | 'bolt'
  /**
   * The spike the harpoon throws.
   *
   * Drawn rather than cut from the sheet, and so wearing the weapon's own
   * colour: every spike in the tileset is the bolt's dagger at another size,
   * which is the one thing this frame exists not to look like.
   */
  | 'harpoon'
  | 'orb'
  /**
   * The lance, drawn stretched to the reach of the thrust that landed — which
   * is why it is the one frame in the atlas wider than it is tall.
   */
  | 'spear'
  /**
   * One patch of burning ground. A trail is a few dozen of these overlapping.
   *
   * Four frames rather than one, cycled by the renderer: fire that holds still
   * is a stain, and a stain is what a single frame was. See `EMBER_FRAMES`.
   */
  | 'ember'
  | 'ember2'
  | 'ember3'
  | 'ember4'
  | 'gem'
  /** A pickup worth more than one XP, told apart by frame rather than by tint. */
  | 'gemRich'
  /** The one thing standing still in the world, holding one of three spoils. */
  | 'chest'
  | 'ring'
  /**
   * The halo a hostile shot wears.
   *
   * Nothing in the world is one — like `ring` it is a frame the renderer asks
   * for and the data never names. It is drawn under every hex, twice as wide,
   * so that a fourteen-pixel object can be found in a crowd of six hundred.
   */
  | 'threat';

/**
 * Every frame name, in a fixed order.
 *
 * The union above is the vocabulary; this is the same vocabulary numbered, so
 * that a sprite can travel over a wire as one byte instead of a string. The
 * order is the contract — appending is safe, reordering is not, and
 * `tests/snapshot.test.ts` checks the list against the union so neither can
 * drift from the other unnoticed.
 */
export const SPRITE_NAMES = [
  'playerBolt',
  'playerOrbit',
  'playerNova',
  'playerSpear',
  'playerHarpoon',
  'playerEmber',
  'grunt',
  'runner',
  'brute',
  'splitter',
  'spawnling',
  'caster',
  'bomber',
  'hex',
  'boss',
  'bolt',
  'harpoon',
  'orb',
  'spear',
  'ember',
  'ember2',
  'ember3',
  'ember4',
  'gem',
  'gemRich',
  'chest',
  'ring',
  'threat',
] as const satisfies readonly SpriteName[];

/** Where a frame sits in `SPRITE_NAMES`, for putting one into a byte. */
export function spriteIndex(name: SpriteName): number {
  return SPRITE_NAMES.indexOf(name);
}
