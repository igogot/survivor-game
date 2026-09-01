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
  /** What a caster throws. The only projectile that belongs to the horde. */
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
  | 'gem'
  /** A pickup worth more than one XP, told apart by frame rather than by tint. */
  | 'gemRich'
  /** The one thing standing still in the world, holding one of three spoils. */
  | 'chest'
  | 'ring';
