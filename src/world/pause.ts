import type { World } from './world';

/**
 * Pausing is a phase rather than a flag.
 *
 * `stepWorld` already refuses to advance a world whose phase is not 'playing',
 * so freezing the simulation costs nothing extra: the run timer, the spawn
 * difficulty curve and every entity stop together, and none of them can drift
 * apart while the player is away. Because `Phase` is a union, adding a member
 * made the compiler point at each place that had to learn about it.
 */
export function canPause(world: World): boolean {
  return world.phase === 'playing' || world.phase === 'levelup' || world.phase === 'chest';
}

export function pauseRun(world: World): void {
  const from = world.phase;
  // Narrowed by the comparison, so `resumeTo` needs no cast.
  if (from !== 'playing' && from !== 'levelup' && from !== 'chest') return;

  world.resumeTo = from;
  world.phase = 'paused';
}

export function resumeRun(world: World): void {
  if (world.phase !== 'paused') return;
  world.phase = world.resumeTo;
}
