import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { dist2 } from '../core/math';
import { applyDamage } from './damage';
import { BROADPHASE_PAD } from './shared';
import type { World } from '../world/world';

/**
 * Advances projectiles and resolves their hits.
 *
 * Damage itself goes through `applyDamage`, which only *marks* a kill; the reap
 * system removes the body at the top of the next tick, because removing it now
 * would invalidate the grid indices this loop is still iterating over.
 */
export function projectileSystem(world: World, dt: number): void {
  const { projectiles, enemies, grid, scratch } = world;
  const queryPad = MAX_ENEMY_RADIUS + BROADPHASE_PAD;

  // Iterating backwards makes swap-removal safe: the element swapped into slot
  // `i` has already been visited this tick.
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i];

    projectile.px = projectile.x;
    projectile.py = projectile.y;
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;

    let spent = projectile.life <= 0;

    if (!spent) {
      grid.query(projectile.x, projectile.y, projectile.radius + queryPad, scratch);

      for (let c = 0; c < scratch.length; c++) {
        const enemy = enemies[scratch[c]];
        if (enemy === undefined || enemy.hp <= 0) continue;
        // A piercing shot must not re-hit the enemy it just passed through.
        if (enemy.id === projectile.lastHitId) continue;

        const reach = projectile.radius + enemy.radius;
        if (dist2(projectile.x, projectile.y, enemy.x, enemy.y) > reach * reach) continue;

        applyDamage(world, enemy, projectile.damage);
        projectile.lastHitId = enemy.id;

        if (projectile.pierce <= 0) {
          spent = true;
          break;
        }
        projectile.pierce--;
      }
    }

    if (spent) {
      projectiles[i] = projectiles[projectiles.length - 1];
      projectiles.pop();
      world.projectilePool.release(projectile);
    }
  }
}
