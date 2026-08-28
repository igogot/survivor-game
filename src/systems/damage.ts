import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { dist2 } from '../core/math';
import { BROADPHASE_PAD } from './shared';
import type { Enemy } from '../world/types';
import type { World } from '../world/world';

/**
 * The single place an enemy loses health.
 *
 * Kills are only *marked* here (hp <= 0); the reap system removes the body at
 * the top of the next tick, because every caller is mid-iteration over grid
 * indices that a removal would invalidate.
 */
/**
 * How long an enemy stays lit after being hit, in seconds.
 *
 * Exported because the renderer fades the flash over exactly this window; two
 * copies of the number would drift and the fade would end early or late.
 */
export const FLASH_TIME = 0.08;

export function applyDamage(world: World, enemy: Enemy, amount: number): void {
  if (enemy.hp <= 0) return;

  enemy.hp -= amount;
  enemy.flash = FLASH_TIME;
  if (enemy.hp <= 0) world.kills++;
}

/**
 * Damages every enemy overlapping a circle, at most once per damage event.
 *
 * `event` comes from `world.nextDamageEvent()` and is shared by every circle
 * belonging to the same attack: a ring of blades queries the grid once per
 * blade, and an enemy caught between two of them must still take one hit. The
 * stamp lives on the enemy, so the de-duplication costs one integer compare
 * instead of a per-pulse Set.
 *
 * Returns the number of enemies hit — handy for tests and for future
 * on-hit effects.
 */
export function damageArea(
  world: World,
  x: number,
  y: number,
  radius: number,
  damage: number,
  event: number,
): number {
  const { grid, enemies, scratch } = world;
  grid.query(x, y, radius + MAX_ENEMY_RADIUS + BROADPHASE_PAD, scratch);

  let hits = 0;
  for (let i = 0; i < scratch.length; i++) {
    const enemy = enemies[scratch[i]];
    if (enemy === undefined || enemy.hp <= 0) continue;
    if (enemy.hitTag === event) continue;

    const reach = radius + enemy.radius;
    if (dist2(x, y, enemy.x, enemy.y) > reach * reach) continue;

    enemy.hitTag = event;
    applyDamage(world, enemy, damage);
    hits++;
  }

  return hits;
}
