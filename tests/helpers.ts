import { CONFIG } from '../src/config';
import { applyUpgrade } from '../src/systems/progression';
import { takeSpoil } from '../src/systems/chests';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';

const DT = 1 / CONFIG.tickRate;

/**
 * Plays a full run in Node with no renderer, no canvas and no timers.
 *
 * The "player" strolls in a slow circle, which is enough to keep spawning,
 * targeting, collisions and pickups all exercised. Because the world is
 * deterministic for a seed, the same call always produces the same run.
 */
export function runHeadless(seed: number, seconds: number): World {
  const world = new World(seed);
  const ticks = Math.round(seconds * CONFIG.tickRate);

  for (let i = 0; i < ticks; i++) {
    if (world.phase === 'dead') break;

    if (world.phase === 'levelup') {
      // Always take the first offer; the point is to keep the run moving, not
      // to play well.
      applyUpgrade(world, world.players[0], world.players[0].offered[0].id);
      continue;
    }

    // Both menus stop the world, so both have to be answered or the rest of
    // the run is a loop over a frozen simulation reporting that nothing
    // happened.
    if (world.phase === 'chest') {
      takeSpoil(world, world.players[0], world.spoils[0].id);
      continue;
    }

    const angle = i * 0.02;
    world.players[0].intentX = Math.cos(angle);
    world.players[0].intentY = Math.sin(angle);
    stepWorld(world, DT);
  }

  return world;
}
