import { CONFIG } from '../config';
import { dist2 } from '../core/math';
import { nearestPlayer, partySize } from '../world/party';
import type { World } from '../world/world';

/**
 * XP gems inside a player's pickup radius accelerate toward them and are
 * collected on contact.
 *
 * Gems never collide with anything, so they skip the grid entirely — a linear
 * scan over a few hundred of them is cheaper than the bookkeeping would be.
 *
 * A gem is pulled by whoever is nearest, and only by them. The alternative —
 * every player pulling on every gem — makes a gem between two of them travel at
 * twice the magnet speed toward nobody in particular, and a gem picked up twice
 * would be XP the horde never paid for.
 *
 * What it pays into is the *party's* bar rather than the collector's. Nearest
 * decides who does the fetching, not who profits: levels arrive for everybody
 * at once, so nobody is punished for guarding a flank while somebody else walks
 * the field. See `World.level`.
 *
 * What it pays is multiplied by the size of the party, because so is the health
 * of the thing that dropped it. An enemy with four times the health takes four
 * times the shooting and is worth four times the experience; without that half
 * of the pair of party multipliers charges and the other half does not pay, and
 * a party ends up levelling at half a solo player's pace. The stand measured
 * exactly that: a duo felled no boss in eight seeds where a solo player felled
 * six.
 *
 * Multiplied here at the pickup rather than stored into `Gem.value`, for two
 * reasons. A gem worth more than one is drawn with a different frame, so baking
 * the party's multiplier in would make every grunt drop a rich-looking gem and
 * erase a distinction the player reads at a glance. And applied here it cancels
 * against `xpForNextLevel` at every instant, including the one where somebody
 * dies mid-bar and both sides of the ratio change together.
 *
 * A harvest widens one player's radius enormously for a few seconds. Nothing
 * else about the pass changes: the gems still fly in and are still collected on
 * contact, which is why a run that never opens a chest behaves exactly as it
 * did before chests existed.
 */
export function pickupSystem(world: World, dt: number): void {
  const { gems } = world;
  const collectRadiusSq = CONFIG.player.collectRadius * CONFIG.player.collectRadius;

  // Every player's harvest burns down once per tick, here rather than inside
  // the gem loop: a player no gem happens to be nearest to still spends their
  // seconds.
  const players = world.players;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.harvest > 0) player.harvest = Math.max(0, player.harvest - dt);
  }

  for (let i = gems.length - 1; i >= 0; i--) {
    const gem = gems[i];
    gem.px = gem.x;
    gem.py = gem.y;

    const owner = nearestPlayer(world, gem.x, gem.y);
    if (owner === null) continue;

    const harvesting = owner.harvest > 0;
    // `max`, not a replacement: a run that has stacked Magnet Core several
    // times must not have its reach cut by the card meant to extend it.
    const magnetRadius = harvesting
      ? Math.max(owner.stats.pickupRadius, CONFIG.chest.harvestRadius)
      : owner.stats.pickupRadius;
    const pullStep = (harvesting ? CONFIG.chest.harvestSpeed : CONFIG.player.magnetSpeed) * dt;
    const distanceSq = dist2(gem.x, gem.y, owner.x, owner.y);

    if (distanceSq <= magnetRadius * magnetRadius && distanceSq > 0) {
      const distance = Math.sqrt(distanceSq);
      gem.x += ((owner.x - gem.x) / distance) * pullStep;
      gem.y += ((owner.y - gem.y) / distance) * pullStep;
    }

    if (distanceSq <= collectRadiusSq) {
      world.xp += gem.value * partySize(world);
      gems[i] = gems[gems.length - 1];
      gems.pop();
      world.gemPool.release(gem);
    }
  }
}
