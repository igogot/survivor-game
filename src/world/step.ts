import { chestSystem } from '../systems/chests';
import { contactSystem } from '../systems/contact';
import { effectSystem } from '../systems/effects';
import { enemyAttackSystem } from '../systems/enemyAttack';
import { movementSystem, separationSystem, steeringSystem } from '../systems/movement';
import { pickupSystem } from '../systems/pickup';
import { progressionSystem } from '../systems/progression';
import { projectileSystem } from '../systems/projectiles';
import { reapSystem } from '../systems/reap';
import { spawnSystem } from '../systems/spawn';
import { weaponSystem } from '../systems/weapons';
import type { World } from './world';

/**
 * One simulation tick.
 *
 * The order matters more than it looks. The broad-phase grid stores *indices*
 * into `world.enemies`, so anything that removes an enemy invalidates it:
 *
 *   1. reap    — remove last tick's dead first, while no index is live
 *   2. spawn   — add new enemies before the grid is built
 *   3. steer   — a standing move order becomes this tick's intent
 *   4. move    — player and enemies advance
 *   5. rebuild — grid now matches the post-movement array exactly
 *   6. combat  — every consumer of the grid runs here, removing nothing;
 *                the horde throws in this half too, which adds projectiles
 *                but never enemies, so no grid index moves
 *   7. progression — may flip the phase to 'levelup' and pause the run
 *
 * Cosmetic effects are advanced with the rest of the bookkeeping, after combat
 * has had its chance to spawn them.
 *
 * Chests sit with the pickups because that is what they are: nothing about
 * them touches the grid, and reaching one stops the run the same way levelling
 * does. When both happen on the same tick the chest wins and the level waits
 * in `pendingLevels` — `progressionSystem` only offers while the phase is
 * still 'playing', so the level-up screen arrives on the tick after the chest
 * is spent rather than on top of it.
 *
 * Separation nudges enemies by a few pixels after the rebuild; the combat
 * systems widen their queries by BROADPHASE_PAD to absorb that drift.
 */
export function stepWorld(world: World, dt: number): void {
  if (world.phase !== 'playing') return;

  world.time += dt;

  reapSystem(world);
  spawnSystem(world, dt);
  steeringSystem(world, dt);
  movementSystem(world, dt);
  rebuildGrid(world);
  separationSystem(world, dt);
  weaponSystem(world, dt);
  enemyAttackSystem(world, dt);
  projectileSystem(world, dt);
  contactSystem(world);
  pickupSystem(world, dt);
  chestSystem(world, dt);
  effectSystem(world, dt);
  progressionSystem(world);
}

/** Exported so a test can put enemies in the world and query them directly. */
export function rebuildGrid(world: World): void {
  const { grid, enemies } = world;
  grid.clear();
  for (let i = 0; i < enemies.length; i++) {
    grid.insert(i, enemies[i].x, enemies[i].y);
  }
}
