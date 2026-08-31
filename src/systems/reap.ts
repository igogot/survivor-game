import { CONFIG } from '../config';
import { TAU, dist2 } from '../core/math';
import { enemyById } from '../data/enemies';
import { bodyCost, defeatBoss, hordeHpScale, spawnEnemyAt } from './spawn';
import type { Enemy } from '../world/types';
import type { World } from '../world/world';

/**
 * Removes enemies killed last tick and those that wandered too far, dropping XP
 * gems for the kills. A dead boss is handed to `defeatBoss`, which schedules
 * the next one — nothing here ends the run.
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
      if (enemy.boss) defeatBoss(world);
      split(world, enemy);
    }

    enemies[i] = enemies[enemies.length - 1];
    enemies.pop();
    world.enemyPool.release(enemy);
  }
}

/**
 * Replaces a dying enemy with whatever it comes apart into.
 *
 * Safe to call from inside the removal loop above, and the reason is that loop's
 * direction. Children are appended at the end — except one, which the
 * swap-remove then moves into the slot the corpse just vacated. The loop counts
 * down, so it revisits neither: a child born this tick is not eligible to be
 * reaped this tick, which is what we want. A loop counting up would check a
 * newborn for straying on the tick it appeared.
 *
 * Children take the horde's current HP scale rather than their parent's share
 * of it. Two half-strength enemies would make killing a splitter late in a run
 * a way of thinning the horde rather than a decision with a cost.
 */
function split(world: World, enemy: Enemy): void {
  const def = enemyById(enemy.defId);
  if (def?.split === undefined) return;

  const child = enemyById(def.split.into);
  if (child === undefined) return;

  const scale = hordeHpScale(world);
  // Scattered around the parent rather than stacked on its centre, so the
  // separation pass is not the thing that has to tell them apart.
  const base = world.rng.next() * TAU;

  let born = 0;
  for (let i = 0; i < def.split.count; i++) {
    // The cap is the horde's, and splitting must not be a way around it.
    if (world.enemies.length >= CONFIG.spawn.maxEnemies) break;

    const angle = base + (TAU * i) / def.split.count;
    spawnEnemyAt(
      world,
      child,
      scale,
      enemy.x + Math.cos(angle) * enemy.radius,
      enemy.y + Math.sin(angle) * enemy.radius,
    );
    born++;
  }

  // One of them stands in for the enemy that just died; the rest are bodies the
  // spawner never budgeted for, so the spawner waits that much longer. This is
  // what keeps a new enemy type from silently retuning the whole difficulty
  // curve — see `bodyCost`.
  const unbudgeted = born - 1;
  if (unbudgeted > 0) world.spawnTimer += bodyCost(world) * unbudgeted;
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
