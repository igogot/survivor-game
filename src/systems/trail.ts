import { damageArea } from './damage';
import type { World } from '../world/world';

/**
 * Burning ground: the entity the trail weapon leaves behind, and the two things
 * that happen to it.
 *
 * It lives here rather than in `src/systems/weapons.ts` because it outlives the
 * shot that made it. Every other weapon resolves inside the tick it fires on —
 * a lance flashes, a shockwave stamps, a bolt is a projectile the projectile
 * system already owns — so the weapon routine is the whole weapon. Fire is not:
 * it is laid on one tick and does its work over the next two hundred, which
 * makes it an entity with a lifetime, and lifetimes belong to a system.
 *
 * `src/systems/weapons.ts` decides *when* to lay and *when* to burn. This file
 * owns what a patch is.
 */

/**
 * Ceiling on patches alive at once.
 *
 * A backstop, not a live limit. The trail's real length is
 * `life * moveSpeed / spacing`, which peaks at level 1 — spacing is a fraction
 * of the radius, so levelling the weapon lays *fewer, wider* patches — and that
 * peak is around forty for a player who has bought every boot in the game. This
 * exists so that a future longer `life` or faster player cannot quietly turn one
 * weapon into an unbounded number of broad-phase queries per burn, the same job
 * `CONFIG.spawn.maxEnemies` does for the horde.
 */
export const MAX_FLAMES = 96;

/**
 * Lights one patch of ground, and reports whether there was room for it.
 *
 * The caller needs the answer: it only advances its record of where the trail
 * reached when a patch actually went down, so a trail interrupted by the cap
 * resumes where it stopped instead of skipping forward to wherever the player
 * has run to since.
 */
export function layFlame(
  world: World,
  x: number,
  y: number,
  radius: number,
  life: number,
  color: number,
): boolean {
  if (world.flames.length >= MAX_FLAMES) return false;

  const flame = world.flamePool.obtain();
  // Every field written unconditionally: the patch comes out of a pool, so a
  // field left alone is not a default but whatever the last one left there.
  flame.x = x;
  flame.y = y;
  flame.radius = radius;
  flame.life = life;
  flame.maxLife = life;
  flame.color = color;

  world.flames.push(flame);
  return true;
}

/**
 * Burns down the patches on the ground and recycles the ones that have gone
 * out.
 *
 * Nothing here touches enemies, so it is free to run anywhere in the tick that
 * is not mid-iteration over the broad-phase — it is scheduled with the rest of
 * the bookkeeping, after combat has had its chance to lay new fire.
 */
export function trailSystem(world: World, dt: number): void {
  const flames = world.flames;

  for (let i = flames.length - 1; i >= 0; i--) {
    const flame = flames[i];
    flame.life -= dt;
    if (flame.life > 0) continue;

    flames[i] = flames[flames.length - 1];
    flames.pop();
    world.flamePool.release(flame);
  }
}

/**
 * Damages everything standing in fire, once.
 *
 * The whole trail resolves as a single damage event, which is the point. A
 * ribbon is a few dozen overlapping circles, so an enemy walking down the
 * middle of one stands inside four or five patches at a time; without the
 * shared event it would take four or five hits and the weapon's damage would
 * depend on how tightly the player happened to be turning. With it, what the
 * fire deals is a function of time spent in the fire and nothing else.
 *
 * The same reasoning the blade ring uses for its own overlapping queries — see
 * `damageArea` — applied to a shape that overlaps far more.
 *
 * Returns the number of enemies burnt.
 */
export function burnTrail(world: World, damage: number, event: number): number {
  const flames = world.flames;
  let hits = 0;

  for (let i = 0; i < flames.length; i++) {
    const flame = flames[i];
    hits += damageArea(world, flame.x, flame.y, flame.radius, damage, event);
  }

  return hits;
}
