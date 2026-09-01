import { CONFIG } from '../config';
import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { dist2 } from '../core/math';
import { applyDamage, damagePlayer } from './damage';
import { BROADPHASE_PAD } from './shared';
import type { Projectile } from '../world/types';
import type { World } from '../world/world';

/**
 * Takes a projectile from the pool and puts it in the world.
 *
 * The caller writes every field, without exception. A pooled projectile
 * carries whatever the last one left, and `hostile` is the field where
 * forgetting that turns the player's bolt into something that shoots them.
 */
export function spawnProjectile(world: World): Projectile {
  const projectile = world.projectilePool.obtain();
  world.projectiles.push(projectile);
  return projectile;
}

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

    if (!spent && projectile.hostile) {
      // Still no broad-phase: the horde's shots look for players and there are
      // at most four of them, which is cheaper to walk than a grid query would
      // be to make. They deliberately go through the same invulnerability
      // window as a body — see `damagePlayer`.
      //
      // A hex is spent on the first player it touches, aimed or not. It was
      // thrown at somebody in particular, but a bottle does not check who it
      // hit on the way.
      const reach = projectile.radius + CONFIG.player.radius;
      const players = world.players;

      for (let c = 0; c < players.length; c++) {
        const player = players[c];
        if (player.hp <= 0) continue;
        if (dist2(projectile.x, projectile.y, player.x, player.y) > reach * reach) continue;

        damagePlayer(world, player, projectile.damage);
        spent = true;
        break;
      }
    } else if (!spent) {
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
