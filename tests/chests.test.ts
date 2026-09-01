import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { xpForNextLevel } from '../src/systems/progression';
import { TAU } from '../src/core/math';
import { BOSS, enemyById } from '../src/data/enemies';
import { SPOILS, SPOIL_CATEGORIES } from '../src/data/spoils';
import { applyUpgrade } from '../src/systems/progression';
import { rollSpoils, takeSpoil } from '../src/systems/chests';
import { spawnEnemyAt } from '../src/systems/spawn';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';

const DT = 1 / CONFIG.tickRate;

/**
 * A chest is the only content in this game that is somewhere rather than
 * everywhere, so the properties worth pinning are all about place and timing:
 * where it is put, that there is one of it, and that the walk actually costs
 * something. The three spoils are tested for what they do to the world rather
 * than for their numbers, which live in CONFIG and are meant to move.
 */

/**
 * Advances the run with the player walking in one direction.
 *
 * Levels are spent on the first card offered — the point is to keep the clock
 * running, not to play well. A chest stops it: that is the state most of these
 * tests are trying to reach.
 */
function play(world: World, seconds: number, x = 1, y = 0): void {
  for (let i = 0; i < Math.round(seconds * CONFIG.tickRate); i++) {
    if (world.phase === 'levelup') {
      applyUpgrade(world, world.players[0], world.players[0].offered[0].id);
      continue;
    }
    if (world.phase !== 'playing') return;

    world.players[0].intentX = x;
    world.players[0].intentY = y;
    stepWorld(world, DT);
  }
}

/** Puts the player on top of the chest and lets one tick notice. */
function walkIntoChest(world: World): void {
  const chest = world.chest;
  if (chest === null) throw new Error('there is no chest to walk into');
  world.players[0].x = chest.x;
  world.players[0].y = chest.y;
  stepWorld(world, DT);
}

describe('placing a chest', () => {
  it('places nothing before the first one is due', () => {
    const world = new World(1);
    play(world, CONFIG.chest.firstAt - 5);
    expect(world.chest).toBeNull();
  });

  it('places one once the timer runs out', () => {
    const world = new World(1);
    play(world, CONFIG.chest.firstAt + 1);
    expect(world.chest).not.toBeNull();
  });

  it('puts it a full walk away', () => {
    const world = new World(2);
    play(world, CONFIG.chest.firstAt + 1);

    const chest = world.chest;
    expect(chest).not.toBeNull();
    const distance = Math.hypot(chest!.x - world.players[0].x, chest!.y - world.players[0].y);
    // The player keeps walking after it is placed, so this is a floor rather
    // than an equality: it was placed at the full distance and closed some.
    expect(distance).toBeGreaterThan(CONFIG.chest.distance / 2);
  });

  /**
   * The whole cost of a chest is the ground between it and the player, and
   * that ground is only expensive if it is ground they have already left.
   * Ahead is where the spawner is putting the next wave anyway, so a chest
   * there would be collected on the way past for nothing.
   */
  it('puts it behind the player rather than in their path', () => {
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const world = new World(seed);
      play(world, CONFIG.chest.firstAt + 1);

      const chest = world.chest;
      expect(chest).not.toBeNull();

      const heading = Math.hypot(world.players[0].headingX, world.players[0].headingY);
      expect(heading).toBeGreaterThan(0.15);

      const toChestX = chest!.x - world.players[0].x;
      const toChestY = chest!.y - world.players[0].y;
      const forward = (toChestX * world.players[0].headingX + toChestY * world.players[0].headingY) / heading;
      expect(forward).toBeLessThan(0);
    }
  });

  /**
   * Standing still has no behind to place one in, so it goes anywhere. Driven
   * from the timer rather than from seventy-five seconds of not moving, which
   * is seventy-five seconds of being walked into.
   */
  it('places one anywhere when the player has not moved', () => {
    const world = new World(9);
    world.chestTimer = 0;
    expect(Math.hypot(world.players[0].headingX, world.players[0].headingY)).toBe(0);

    stepWorld(world, DT);
    expect(world.chest).not.toBeNull();
  });

  /** The next one is not scheduled until this one is taken. */
  it('holds the timer while one is waiting to be fetched', () => {
    const world = new World(10);
    play(world, CONFIG.chest.firstAt + 1);
    expect(world.chest).not.toBeNull();

    const stopped = world.chestTimer;
    play(world, CONFIG.chest.interval + 30);
    expect(world.chestTimer).toBe(stopped);
  });

  /**
   * A chest is placed behind a player who is faster than anything chasing
   * them, so it can be outrun — and one left far enough back would block every
   * later chest for the whole run, because the next is not scheduled until
   * this one is taken. Put down again rather than taken away: nothing was
   * spent, so the offer still stands.
   */
  it('puts an outrun chest down again instead of losing it', () => {
    const world = new World(10);
    play(world, CONFIG.chest.firstAt + 1);
    const first = world.chest;
    expect(first).not.toBeNull();

    play(world, CONFIG.chest.abandonAt / CONFIG.player.moveSpeed + 5);

    const moved = world.chest;
    expect(moved).not.toBeNull();
    expect(moved).not.toBe(first);
    expect(Math.hypot(moved!.x - world.players[0].x, moved!.y - world.players[0].y)).toBeLessThanOrEqual(
      CONFIG.chest.abandonAt,
    );
  });

  /** Replacements are placements too, and a duel is no place for either. */
  it('leaves an outrun chest where it is during a duel', () => {
    const world = new World(10);
    play(world, CONFIG.chest.firstAt + 1);
    const first = world.chest;
    expect(first).not.toBeNull();

    world.bossSpawned = true;
    play(world, CONFIG.chest.abandonAt / CONFIG.player.moveSpeed + 5);
    expect(world.chest).toBe(first);
  });

  /**
   * The duel turns the spawner off, so the field is empty and the walk to a
   * chest would cost nothing at all. A reward for crossing free ground is a
   * reward for waiting.
   */
  it('places none while a boss is on the field', () => {
    const world = new World(11);
    world.chestTimer = 0;
    world.bossSpawned = true;

    play(world, 5);
    expect(world.chest).toBeNull();

    world.bossSpawned = false;
    play(world, 1);
    expect(world.chest).not.toBeNull();
  });

  it('schedules the next one only once this one is taken', () => {
    const world = new World(12);
    play(world, CONFIG.chest.firstAt + 1);
    walkIntoChest(world);

    expect(world.chest).toBeNull();
    expect(world.chestTimer).toBeCloseTo(CONFIG.chest.interval, 5);
  });
});

describe('opening a chest', () => {
  it('stops the run and offers three spoils', () => {
    const world = new World(13);
    play(world, CONFIG.chest.firstAt + 1);
    walkIntoChest(world);

    expect(world.phase).toBe('chest');
    expect(world.spoils).toHaveLength(SPOIL_CATEGORIES.length);
    expect(world.chest).toBeNull();
  });

  /**
   * One of each, so the chest answers whichever kind of trouble the run is in.
   * Three cards from one category would be one option wearing three hats.
   */
  it('offers one of every category', () => {
    const world = new World(14);
    const spoils = rollSpoils(world);
    expect(spoils.map((spoil) => spoil.category)).toEqual(SPOIL_CATEGORIES);
  });

  it('freezes the simulation while it is open', () => {
    const world = new World(15);
    play(world, CONFIG.chest.firstAt + 1);
    walkIntoChest(world);

    const time = world.time;
    const enemies = world.enemies.length;
    play(world, 3);

    expect(world.time).toBe(time);
    expect(world.enemies.length).toBe(enemies);
  });

  it('hands the run back once a spoil is taken', () => {
    const world = new World(16);
    play(world, CONFIG.chest.firstAt + 1);
    walkIntoChest(world);

    takeSpoil(world, world.players[0], world.spoils[0].id);
    expect(world.phase).toBe('playing');
    expect(world.spoils).toHaveLength(0);
  });

  /** A key held down from a previous menu must not spend an unoffered card. */
  it('ignores a spoil this chest did not offer', () => {
    const world = new World(17);
    play(world, CONFIG.chest.firstAt + 1);
    walkIntoChest(world);
    world.spoils = world.spoils.filter((spoil) => spoil.id !== 'purge');

    takeSpoil(world, world.players[0], 'purge');
    expect(world.phase).toBe('chest');

    takeSpoil(world, world.players[0], 'nothing-of-the-sort');
    expect(world.phase).toBe('chest');
  });

  it('does nothing at all outside the chest screen', () => {
    const world = new World(18);
    world.players[0].hp = 10;
    takeSpoil(world, world.players[0], 'mend');
    expect(world.players[0].hp).toBe(10);
  });
});

describe('mend', () => {
  it('restores its share of the maximum', () => {
    const world = new World(19);
    world.phase = 'chest';
    world.spoils = SPOILS.filter((spoil) => spoil.id === 'mend');
    world.players[0].hp = 10;

    takeSpoil(world, world.players[0], 'mend');
    expect(world.players[0].hp).toBeCloseTo(
      10 + world.players[0].stats.maxHp * CONFIG.chest.mendFraction,
      5,
    );
  });

  /** The card says so, and it is what makes taking it at full health a waste. */
  it('never overfills the bar', () => {
    const world = new World(20);
    world.phase = 'chest';
    world.spoils = SPOILS.filter((spoil) => spoil.id === 'mend');
    world.players[0].hp = world.players[0].stats.maxHp - 1;

    takeSpoil(world, world.players[0], 'mend');
    expect(world.players[0].hp).toBe(world.players[0].stats.maxHp);
  });
});

describe('purge', () => {
  /**
   * A ring of grunts placed by hand rather than a horde grown by playing. What
   * this card does is a property of the array it is handed, and a run is a
   * slower and less certain way of filling one.
   */
  function buried(seed: number, count = 40): World {
    const world = new World(seed);
    const grunt = enemyById('grunt');
    if (grunt === undefined) throw new Error('the horde lost its grunt');

    for (let i = 0; i < count; i++) {
      const angle = (i * TAU) / count;
      spawnEnemyAt(
        world,
        grunt,
        1,
        world.players[0].x + Math.cos(angle) * 200,
        world.players[0].y + Math.sin(angle) * 200,
      );
    }

    world.phase = 'chest';
    world.spoils = SPOILS.filter((spoil) => spoil.id === 'purge');
    return world;
  }

  it('kills the whole horde and counts every one of them', () => {
    const world = buried(21);
    const standing = world.enemies.length;
    const killsBefore = world.kills;

    takeSpoil(world, world.players[0], 'purge');
    expect(world.enemies.every((enemy) => enemy.hp <= 0)).toBe(true);
    expect(world.kills).toBe(killsBefore + standing);
  });

  /**
   * Marked dead rather than removed, because the grid holds indices into this
   * array and `reapSystem` is the only place allowed to invalidate them. The
   * bodies leave on the next tick, and every one of them drops its gem — which
   * is most of what the card is worth.
   */
  it('leaves the bodies for the reaper and their gems for the player', () => {
    const world = buried(22);
    const standing = world.enemies.length;
    const gemsBefore = world.gems.length;

    takeSpoil(world, world.players[0], 'purge');
    expect(world.enemies).toHaveLength(standing);

    stepWorld(world, DT);
    expect(world.enemies.length).toBeLessThan(standing);
    expect(world.gems.length).toBeGreaterThan(gemsBefore);
  });

  /** The one fight the game asks to be won is not settled from a menu. */
  it('leaves the boss standing', () => {
    const world = buried(23);
    spawnEnemyAt(world, BOSS, 1, world.players[0].x + 60, world.players[0].y);
    const boss = world.enemies[world.enemies.length - 1];
    expect(boss.boss).toBe(true);

    takeSpoil(world, world.players[0], 'purge');
    expect(boss.hp).toBeGreaterThan(0);
  });
});

describe('harvest', () => {
  /** Drops a gem the ordinary magnet could never reach. */
  function strandGem(world: World, distance: number): void {
    const grunt = enemyById('grunt');
    if (grunt === undefined) throw new Error('the horde lost its grunt');
    spawnEnemyAt(world, grunt, 1, world.players[0].x + distance, world.players[0].y);
    const enemy = world.enemies[world.enemies.length - 1];
    enemy.hp = 0;
    stepWorld(world, DT);
  }

  it('collects what the player walked past', () => {
    const world = new World(24);
    strandGem(world, CONFIG.chest.harvestRadius * 0.8);
    const loose = world.gems.length;
    expect(loose).toBeGreaterThan(0);

    world.phase = 'chest';
    world.spoils = SPOILS.filter((spoil) => spoil.id === 'harvest');
    takeSpoil(world, world.players[0], 'harvest');

    // Standing still, so nothing new is dropped and nothing is walked over.
    play(world, CONFIG.chest.harvestTime, 0, 0);
    expect(world.gems.length).toBeLessThan(loose);
  });

  /**
   * The reach is finite on purpose. Gems are never cleaned up, so by the tenth
   * minute several thousand of them are lying where the player has been — a
   * pull with no limit would hand over ten levels at once and end the run as a
   * contest.
   */
  it('leaves what is beyond its reach', () => {
    const world = new World(25);
    strandGem(world, CONFIG.chest.harvestRadius * 3);
    const far = world.gems[world.gems.length - 1];
    const distanceBefore = Math.hypot(far.x - world.players[0].x, far.y - world.players[0].y);

    world.phase = 'chest';
    world.spoils = SPOILS.filter((spoil) => spoil.id === 'harvest');
    takeSpoil(world, world.players[0], 'harvest');
    play(world, CONFIG.chest.harvestTime, 0, 0);

    expect(Math.hypot(far.x - world.players[0].x, far.y - world.players[0].y)).toBeCloseTo(
      distanceBefore,
      5,
    );
  });

  it('stops pulling when it runs out', () => {
    const world = new World(26);
    world.phase = 'chest';
    world.spoils = SPOILS.filter((spoil) => spoil.id === 'harvest');
    takeSpoil(world, world.players[0], 'harvest');
    expect(world.players[0].harvest).toBeCloseTo(CONFIG.chest.harvestTime, 5);

    play(world, CONFIG.chest.harvestTime + 1, 0, 0);
    expect(world.players[0].harvest).toBe(0);

    strandGem(world, CONFIG.chest.harvestRadius * 0.8);
    const far = world.gems[world.gems.length - 1];
    const distanceBefore = Math.hypot(far.x - world.players[0].x, far.y - world.players[0].y);
    play(world, 1, 0, 0);

    expect(Math.hypot(far.x - world.players[0].x, far.y - world.players[0].y)).toBeCloseTo(
      distanceBefore,
      5,
    );
  });

  /**
   * It has to cross its own reach inside its own lifetime even with the player
   * running the other way, or the card quietly delivers less than it promises.
   */
  it('travels further than it reaches', () => {
    expect(CONFIG.chest.harvestSpeed * CONFIG.chest.harvestTime).toBeGreaterThan(
      CONFIG.chest.harvestRadius + CONFIG.player.moveSpeed * CONFIG.chest.harvestTime,
    );
  });
});

describe('the chest and the level-up screen', () => {
  /**
   * A sweep hands over a few hundred gems at once, which is several levels.
   * They have to queue behind the chest rather than land on top of it.
   */
  it('holds a level gained on the same tick until the chest is spent', () => {
    const world = new World(27);
    play(world, CONFIG.chest.firstAt + 1);

    world.xp = xpForNextLevel(world);
    walkIntoChest(world);

    expect(world.phase).toBe('chest');
    expect(world.players[0].pendingLevels).toBeGreaterThan(0);

    takeSpoil(world, world.players[0], world.spoils[0].id);
    stepWorld(world, DT);
    expect(world.phase).toBe('levelup');
  });
});
