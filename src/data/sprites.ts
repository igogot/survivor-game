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
  | 'player'
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
  | 'orb'
  | 'gem'
  /** A pickup worth more than one XP, told apart by frame rather than by tint. */
  | 'gemRich'
  | 'ring';
