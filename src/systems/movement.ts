import { approach } from '../core/steering';
import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { BROADPHASE_PAD } from './shared';
import type { World } from '../world/world';

/** Time constant of the heading average, in seconds. */
const HEADING_TAU = 0.6;

/**
 * Turns a standing move order into this tick's intent.
 *
 * Runs before the move, so what it writes is what gets spent. It writes nothing
 * unless the player is otherwise still: a hand back on the keys or the stick
 * takes control immediately and throws the order away, rather than fighting a
 * click the player has already forgotten about.
 *
 * The order lives in the world and is resolved here rather than in the input
 * layer for the same reason the rest of the simulation does: walking to a point
 * takes hundreds of ticks, and every one of them has to be reproducible from a
 * `World` alone, with no browser in the room.
 */
export function steeringSystem(world: World, dt: number): void {
  const target = world.moveTarget;
  if (target === null) return;

  if (world.intentX !== 0 || world.intentY !== 0) {
    world.moveTarget = null;
    return;
  }

  const player = world.player;
  const walk = approach(player.x, player.y, target.x, target.y, player.stats.moveSpeed * dt);

  world.intentX = walk.x;
  world.intentY = walk.y;
  if (walk.arrived) world.moveTarget = null;
}

/** Moves the player by this tick's intent and steers every enemy toward them. */
export function movementSystem(world: World, dt: number): void {
  const player = world.player;

  player.px = player.x;
  player.py = player.y;
  player.x += world.intentX * player.stats.moveSpeed * dt;
  player.y += world.intentY * player.stats.moveSpeed * dt;

  if (player.invuln > 0) player.invuln -= dt;

  // Exponential average rather than the raw intent: framed in seconds, so it
  // behaves the same whatever the tick rate is set to.
  const smoothing = 1 - Math.exp(-dt / HEADING_TAU);
  world.headingX += (world.intentX - world.headingX) * smoothing;
  world.headingY += (world.intentY - world.headingY) * smoothing;

  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    enemy.px = enemy.x;
    enemy.py = enemy.y;

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.001) {
      const step = (enemy.speed * dt) / distance;
      enemy.x += dx * step;
      enemy.y += dy * step;
    }

    if (enemy.flash > 0) enemy.flash -= dt;
  }
}

/**
 * Pushes overlapping enemies apart.
 *
 * Without it every enemy converges onto the exact same point and the horde
 * renders as a single dot — the crowd reads as a crowd only because of this
 * pass. It is also the cheapest possible demonstration of the grid paying off:
 * done naively it is O(n²) over the whole horde.
 */
export function separationSystem(world: World, dt: number): void {
  const { enemies, grid, scratch } = world;
  const strength = 26 * dt;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    // The boss holds its ground rather than being shoved by its own minions.
    if (enemy.boss) continue;

    grid.query(enemy.x, enemy.y, enemy.radius + MAX_ENEMY_RADIUS + BROADPHASE_PAD, scratch);

    let pushX = 0;
    let pushY = 0;
    for (let c = 0; c < scratch.length; c++) {
      const otherIndex = scratch[c];
      if (otherIndex === i) continue;

      const other = enemies[otherIndex];
      const dx = enemy.x - other.x;
      const dy = enemy.y - other.y;
      const overlap = enemy.radius + other.radius;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= overlap * overlap || distanceSq === 0) continue;

      const distance = Math.sqrt(distanceSq);
      pushX += dx / distance;
      pushY += dy / distance;
    }

    if (pushX !== 0 || pushY !== 0) {
      const length = Math.hypot(pushX, pushY);
      enemy.x += (pushX / length) * strength;
      enemy.y += (pushY / length) * strength;
    }
  }
}
