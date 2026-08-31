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
  /** The spike the harpoon throws: heavier and slower than a bolt, and it reads
   * that way standing still, which is the whole reason it is not a big bolt. */
  | 'harpoon'
  | 'orb'
  /** The lance, drawn stretched to the reach of the thrust that landed. */
  | 'spear'
  | 'gem'
  /** A pickup worth more than one XP, told apart by frame rather than by tint. */
  | 'gemRich'
  | 'ring';
