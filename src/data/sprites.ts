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
  | 'boss'
  | 'bolt'
  | 'orb'
  | 'gem'
  | 'ring';
