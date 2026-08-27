import { CONFIG } from '../config';
import { dist2 } from '../core/math';
import type { World } from '../world/world';

/**
 * XP gems inside the pickup radius accelerate toward the player and are
 * collected on contact.
 *
 * Gems never collide with anything, so they skip the grid entirely — a linear
 * scan over a few hundred of them is cheaper than the bookkeeping would be.
 */
export function pickupSystem(world: World, dt: number): void {
  const { player, gems } = world;

  const magnetRadius = player.stats.pickupRadius;
  const magnetRadiusSq = magnetRadius * magnetRadius;
  const collectRadiusSq = CONFIG.player.collectRadius * CONFIG.player.collectRadius;
  const pullStep = CONFIG.player.magnetSpeed * dt;

  for (let i = gems.length - 1; i >= 0; i--) {
    const gem = gems[i];
    gem.px = gem.x;
    gem.py = gem.y;

    const distanceSq = dist2(gem.x, gem.y, player.x, player.y);

    if (distanceSq <= magnetRadiusSq && distanceSq > 0) {
      const distance = Math.sqrt(distanceSq);
      gem.x += ((player.x - gem.x) / distance) * pullStep;
      gem.y += ((player.y - gem.y) / distance) * pullStep;
    }

    if (distanceSq <= collectRadiusSq) {
      player.xp += gem.value;
      gems[i] = gems[gems.length - 1];
      gems.pop();
      world.gemPool.release(gem);
    }
  }
}
