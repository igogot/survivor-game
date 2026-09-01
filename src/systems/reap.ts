import { CONFIG } from '../config';
import { TAU, dist2 } from '../core/math';
import { enemyById } from '../data/enemies';
import { nearestPlayerDistanceSq } from '../world/party';
import { damagePlayer } from './damage';
import { spawnEffect } from './effects';
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
  const { enemies } = world;
  const despawnSq = CONFIG.spawn.despawnRadius * CONFIG.spawn.despawnRadius;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    const killed = enemy.hp <= 0;
    // The boss chases forever; ordinary enemies left far behind are recycled so
    // the horde does not grow unbounded when the players keep running.
    //
    // Measured to the *nearest* player and not to any particular one. Against a
    // scattered party the obvious reading of the old rule deletes the crowd
    // chasing everybody but the first person in the array, which looks like
    // enemies vanishing rather than like a bug.
    const strayed = !enemy.boss && nearestPlayerDistanceSq(world, enemy.x, enemy.y) > despawnSq;

    if (!killed && !strayed) continue;

    if (killed) {
      dropGem(world, enemy);
      if (enemy.boss) defeatBoss(world);
      split(world, enemy);
      detonate(world, enemy);
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

/** How long the blast ring stays on screen. Cosmetic; the damage is instant. */
const BLAST_LIFE = 0.28;

/**
 * The blast a bomber leaves behind.
 *
 * It hurts the player and nothing else, which is deliberate rather than
 * unfinished: a blast that also thinned the horde would make killing bombers
 * *good*, and the whole point of this enemy is that killing has a price. The
 * ring is drawn for the same reason the shockwave is — an instant hit with no
 * picture reads as the game cheating.
 *
 * It goes through `damagePlayer`, so it obeys the same invulnerability window
 * as a body and a hex. That is also why it hits for more than the brute does:
 * under that window the largest hit in flight wins, and a small blast would
 * quietly protect the player instead of hurting them.
 */
function detonate(world: World, enemy: Enemy): void {
  const def = enemyById(enemy.defId);
  if (def?.detonate === undefined) return;

  spawnEffect(world, enemy.x, enemy.y, def.detonate.radius, BLAST_LIFE, enemy.color);

  // Everyone standing in it, not the nearest one: a blast is a place, and two
  // players who both walked into it have both walked into it.
  const reach = def.detonate.radius + CONFIG.player.radius;
  const players = world.players;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (dist2(enemy.x, enemy.y, player.x, player.y) > reach * reach) continue;
    damagePlayer(world, player, def.detonate.damage);
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
