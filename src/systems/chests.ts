import { CONFIG } from '../config';
import { SPOIL_CATEGORIES, spoilById, spoilsOf } from '../data/spoils';
import { TAU, dist2 } from '../core/math';
import { applyDamage, healPlayer } from './damage';
import type { SpoilDef } from '../data/spoils';
import type { Chest } from '../world/types';
import type { World } from '../world/world';

/**
 * The chest: the only reason this game has to go anywhere in particular.
 *
 * Everything else the world contains comes to the player — enemies walk in,
 * gems fly in, weapons fire themselves. A chest sits still at a fixed distance
 * and has to be fetched, which turns "where do I stand" into "is it worth
 * crossing the field for", and it is the only use the walk-here order has
 * outside of repositioning.
 *
 * The cost is real because of where it is put. Most spawns are placed in the
 * player's path, so the ground ahead is where the game is sending its next
 * wave; the ground behind is the crowd already following. A chest is always
 * behind, so taking it means turning into what has been chasing you.
 */
export function chestSystem(world: World, dt: number): void {
  placeChest(world, dt);
  openReachedChest(world);
}

/**
 * Puts a chest on the ground when one is due, and moves one that has been left
 * too far behind.
 *
 * The timer only runs while there is nothing to fetch, so the field never
 * fills with chests: there is one, and the next is not scheduled until it is
 * taken. That rule is what makes the second half of this function necessary.
 * A chest is placed behind a player who is faster than anything chasing them,
 * so it can be outrun — and one left far enough back would block every later
 * chest for the whole run. It is put down again instead, closer and still
 * behind: nothing was spent, so the offer should still stand.
 */
function placeChest(world: World, dt: number): void {
  // Nothing is put down during a duel, first one or replacement. The spawner
  // is off for it, so the field is empty and the walk would be free — and a
  // reward for crossing ground that costs nothing to cross is not a reward.
  if (world.bossSpawned) return;

  const chest = world.chest;
  if (chest !== null) {
    const abandoned = CONFIG.chest.abandonAt;
    if (dist2(world.player.x, world.player.y, chest.x, chest.y) > abandoned * abandoned) {
      world.chest = chestSpot(world);
    }
    return;
  }

  world.chestTimer -= dt;
  if (world.chestTimer > 0) return;

  world.chest = chestSpot(world);
}

/** A place to put one: a full walk away, on the ground already crossed. */
function chestSpot(world: World): Chest {
  const angle = chestAngle(world);
  return {
    x: world.player.x + Math.cos(angle) * CONFIG.chest.distance,
    y: world.player.y + Math.sin(angle) * CONFIG.chest.distance,
  };
}

/**
 * Which way from the player a chest is placed.
 *
 * Behind, in a wide arc. Placing it ahead would put it where the player was
 * already going, on ground the spawner is already filling for them — the trip
 * would cost nothing and the choice would be free. Standing still has no
 * behind, so it goes anywhere.
 */
function chestAngle(world: World): number {
  const heading = Math.hypot(world.headingX, world.headingY);
  if (heading < 0.15) return world.rng.next() * TAU;

  const forward = Math.atan2(world.headingY, world.headingX);
  return forward + Math.PI + world.rng.range(-CONFIG.chest.spread, CONFIG.chest.spread);
}

/**
 * Opens the chest when the player walks into it.
 *
 * There is no key to press: the game has none for interacting and it is played
 * with a thumb as often as with a keyboard. Touching it is the whole gesture,
 * and the screen that follows is the confirmation.
 */
function openReachedChest(world: World): void {
  const chest = world.chest;
  if (chest === null) return;

  const reach = CONFIG.player.radius + CONFIG.chest.radius;
  if (dist2(world.player.x, world.player.y, chest.x, chest.y) > reach * reach) return;

  world.chest = null;
  world.chestTimer = CONFIG.chest.interval;
  world.spoils = rollSpoils(world);
  world.phase = 'chest';
}

/**
 * One spoil from each category, in category order.
 *
 * Never three of a kind, which is what keeps the choice a choice: a chest
 * offering two ways to heal and one to clear is really offering two options.
 * It also means a chest is worth opening whatever state the run is in — hurt,
 * buried, or neither — because exactly one of the three answers that.
 */
export function rollSpoils(world: World): SpoilDef[] {
  const offers: SpoilDef[] = [];

  for (const category of SPOIL_CATEGORIES) {
    const pool = spoilsOf(category);
    // A category with nothing in it can only mean the table lost an entry;
    // skipping leaves a two-card chest rather than an undefined on screen.
    if (pool.length === 0) continue;
    offers.push(world.rng.pick(pool));
  }

  return offers;
}

/**
 * Spends the chosen spoil and hands the run back.
 *
 * Applied here rather than from a function on the definition, so `data/spoils`
 * stays a table the simulation reads and never a place that reaches into the
 * world — the same split that keeps `WeaponDef` free of `weaponSystem`.
 */
export function takeSpoil(world: World, id: string): void {
  if (world.phase !== 'chest') return;

  const def = spoilById(id);
  // Only what this chest actually put on screen. Otherwise a stray id — a key
  // held down from a previous menu, a console poke — would spend a spoil the
  // player was never offered.
  if (def === undefined || !world.spoils.some((spoil) => spoil.id === def.id)) return;

  switch (def.id) {
    case 'mend':
      healPlayer(world, world.player.stats.maxHp * CONFIG.chest.mendFraction);
      break;
    case 'purge':
      sweep(world);
      break;
    case 'harvest':
      world.harvest = CONFIG.chest.harvestTime;
      break;
    default: {
      // Exhaustiveness check: a spoil added to the table without an effect
      // here stops compiling rather than being a card that does nothing.
      const unhandled: never = def.id;
      throw new Error(`Unhandled spoil: ${String(unhandled)}`);
    }
  }

  world.spoils = [];
  world.phase = 'playing';
}

/**
 * Kills every ordinary enemy on the field.
 *
 * Marks them dead through `applyDamage` rather than emptying the array, for
 * the reason the tick order is written down in `stepWorld`: the broad-phase
 * grid holds indices into `world.enemies`, and a removal from outside
 * `reapSystem` invalidates them. Going through the normal death also means the
 * kills are counted and every body still drops its gem, which is most of what
 * the card is worth.
 *
 * The boss is exempt. It is the one fight the game asks the player to actually
 * win, and a card that ended it would make the duel a matter of inventory.
 */
function sweep(world: World): void {
  const enemies = world.enemies;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.boss || enemy.hp <= 0) continue;
    applyDamage(world, enemy, enemy.hp);
  }
}
