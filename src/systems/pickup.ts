import { CONFIG } from '../config';
import { dist2 } from '../core/math';
import { nearestPlayer } from '../world/party';
import type { World } from '../world/world';

/**
 * XP gems inside a player's pickup radius accelerate toward them and are
 * collected on contact.
 *
 * Gems never collide with anything, so they skip the grid entirely — a linear
 * scan over a few hundred of them is cheaper than the bookkeeping would be.
 *
 * A gem belongs to whoever is nearest, and only to them. The alternative —
 * every player pulling on every gem — makes a gem between two of them travel at
 * twice the magnet speed toward nobody in particular, and a gem picked up twice
 * would be XP the horde never paid for. Nearest also settles the harder
 * question by default: XP is not shared, so a player who does the walking gets
 * the levels.
 */
export function pickupSystem(world: World, dt: number): void {
  const { gems } = world;

  const collectRadiusSq = CONFIG.player.collectRadius * CONFIG.player.collectRadius;
  const pullStep = CONFIG.player.magnetSpeed * dt;

  for (let i = gems.length - 1; i >= 0; i--) {
    const gem = gems[i];
    gem.px = gem.x;
    gem.py = gem.y;

    const owner = nearestPlayer(world, gem.x, gem.y);
    if (owner === null) continue;

    const magnetRadius = owner.stats.pickupRadius;
    const distanceSq = dist2(gem.x, gem.y, owner.x, owner.y);

    if (distanceSq <= magnetRadius * magnetRadius && distanceSq > 0) {
      const distance = Math.sqrt(distanceSq);
      gem.x += ((owner.x - gem.x) / distance) * pullStep;
      gem.y += ((owner.y - gem.y) / distance) * pullStep;
    }

    if (distanceSq <= collectRadiusSq) {
      owner.xp += gem.value;
      gems[i] = gems[gems.length - 1];
      gems.pop();
      world.gemPool.release(gem);
    }
  }
}
