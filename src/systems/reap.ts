import { CONFIG } from '../config';
import { dist2 } from '../core/math';
import type { Enemy } from '../world/types';
import type { World } from '../world/world';

/**
 * Removes enemies killed last tick and those that wandered too far, dropping XP
 * gems for the kills.
 *
 * Runs at the very top of the tick, before the grid is rebuilt, so no live
 * broad-phase index is ever invalidated mid-iteration.
 */
export function reapSystem(world: World): void {
  const { enemies, player } = world;
  const despawnSq = CONFIG.spawn.despawnRadius * CONFIG.spawn.despawnRadius;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    const killed = enemy.hp <= 0;
    // The boss chases forever; ordinary enemies left far behind are recycled so
    // the horde does not grow unbounded when the player keeps running.
    const strayed = !enemy.boss && dist2(enemy.x, enemy.y, player.x, player.y) > despawnSq;

    if (!killed && !strayed) continue;

    if (killed) {
      dropGem(world, enemy);
      if (enemy.boss) world.phase = 'won';
    }

    enemies[i] = enemies[enemies.length - 1];
    enemies.pop();
    world.enemyPool.release(enemy);
  }
}

function dropGem(world: World, enemy: Enemy): void {
  const gem = world.gemPool.obtain();
  gem.x = enemy.x;
  gem.y = enemy.y;
  gem.px = gem.x;
  gem.py = gem.y;
  gem.value = enemy.xpValue;
  world.gems.push(gem);
}
