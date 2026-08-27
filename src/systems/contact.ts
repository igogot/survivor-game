import { CONFIG } from '../config';
import { MAX_ENEMY_RADIUS } from '../data/enemies';
import { dist2 } from '../core/math';
import { BROADPHASE_PAD } from './shared';
import type { World } from '../world/world';

/**
 * Enemies damage the player by touching them.
 *
 * Overlapping enemies deal only the single largest hit rather than stacking:
 * standing in a crowd of forty would otherwise be instant death, and the genre
 * depends on being able to graze through a horde.
 *
 * The invulnerability timer is decremented in the movement system, so this runs
 * once per tick and either applies a hit or does nothing.
 */
export function contactSystem(world: World): void {
  const player = world.player;
  if (player.invuln > 0) return;

  const { grid, enemies, scratch } = world;
  grid.query(
    player.x,
    player.y,
    CONFIG.player.radius + MAX_ENEMY_RADIUS + BROADPHASE_PAD,
    scratch,
  );

  let worstHit = 0;
  for (let i = 0; i < scratch.length; i++) {
    const enemy = enemies[scratch[i]];
    if (enemy === undefined || enemy.hp <= 0) continue;

    const reach = CONFIG.player.radius + enemy.radius;
    if (dist2(player.x, player.y, enemy.x, enemy.y) > reach * reach) continue;
    if (enemy.damage > worstHit) worstHit = enemy.damage;
  }

  if (worstHit <= 0) return;

  player.hp -= worstHit;
  player.invuln = CONFIG.player.invulnTime;

  if (player.hp <= 0) {
    player.hp = 0;
    world.phase = 'dead';
  }
}
