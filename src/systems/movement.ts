import { approach } from '../core/steering';
import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { isAlive, nearestPlayer } from '../world/party';
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
  const players = world.players;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!isAlive(player)) continue;

    const target = player.moveTarget;
    if (target === null) continue;

    if (player.intentX !== 0 || player.intentY !== 0) {
      player.moveTarget = null;
      continue;
    }

    const walk = approach(player.x, player.y, target.x, target.y, player.stats.moveSpeed * dt);

    player.intentX = walk.x;
    player.intentY = walk.y;
    if (walk.arrived) player.moveTarget = null;
  }
}

/**
 * Moves every player by their own intent, then steers each enemy toward
 * whichever of them is closest.
 *
 * The players move first and all of them move before any enemy does, so no
 * enemy chases a stale position while another chases a fresh one — the horde
 * sees one frame of the world, not a half-updated one.
 */
export function movementSystem(world: World, dt: number): void {
  // Exponential average rather than the raw intent: framed in seconds, so it
  // behaves the same whatever the tick rate is set to.
  const smoothing = 1 - Math.exp(-dt / HEADING_TAU);
  const players = world.players;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    // A body does not walk. Without this the corpse of a downed player slides
    // around under whatever the keyboard is still saying, which is what it did
    // until somebody asked what death looks like.
    if (!isAlive(player)) continue;

    player.px = player.x;
    player.py = player.y;
    player.x += player.intentX * player.stats.moveSpeed * dt;
    player.y += player.intentY * player.stats.moveSpeed * dt;

    if (player.invuln > 0) player.invuln -= dt;

    player.headingX += (player.intentX - player.headingX) * smoothing;
    player.headingY += (player.intentY - player.headingY) * smoothing;
  }

  const enemies = world.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    enemy.px = enemy.x;
    enemy.py = enemy.y;

    // Re-asked every tick rather than remembered, so an enemy switches to
    // whoever walked past it. Whether that is the right rule is exactly what
    // the four-player stand has to answer — see `nearestPlayer`.
    const target = nearestPlayer(world, enemy.x, enemy.y);
    const dx = target === null ? 0 : target.x - enemy.x;
    const dy = target === null ? 0 : target.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.001) {
      // A ranged enemy closes to its standoff and stops. Walking the last four
      // hundred pixels would make it an ordinary enemy that also throws, and
      // the point of it is to be the one thing kiting does not solve.
      const closing = distance > enemy.standoff ? 1 : 0;
      const step = (closing * enemy.speed * dt) / distance;
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
