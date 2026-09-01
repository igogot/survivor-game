import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BOSS, ENEMIES } from '../src/data/enemies';
import { WEAPONS } from '../src/data/weapons';
import { contactSystem } from '../src/systems/contact';
import { damagePlayer } from '../src/systems/damage';
import { movementSystem } from '../src/systems/movement';
import { pickupSystem } from '../src/systems/pickup';
import { applyUpgrade, progressionSystem } from '../src/systems/progression';
import { reapSystem } from '../src/systems/reap';
import { spawnEnemyAt } from '../src/systems/spawn';
import { weaponSystem } from '../src/systems/weapons';
import { anyAlive, nearestPlayer, partyAnchor } from '../src/world/party';
import { rebuildGrid, stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import type { Enemy, Player } from '../src/world/types';

/**
 * A world with more than one player in it.
 *
 * Everything here is about the questions that had a trivial answer while there
 * was one: who does an enemy walk toward, whose ring does a wave spawn on,
 * whose gem is that, and when is the run over. The single-player answers are
 * pinned by every other file in this suite — what these check is that the same
 * code does something defensible when the list is longer than one.
 */

const DT = 1 / 60;

function party(seed: number, count: number): World {
  return new World(seed, Array.from({ length: count }, () => 'bolt'));
}

function place(world: World, index: number, x: number, y: number): Player {
  const player = world.players[index];
  player.x = x;
  player.y = y;
  player.px = x;
  player.py = y;
  return player;
}

function grunt(world: World, x: number, y: number): Enemy {
  spawnEnemyAt(world, ENEMIES[0], 1, x, y);
  return world.enemies[world.enemies.length - 1];
}

describe('building a party', () => {
  it('arms each player with the weapon they chose', () => {
    const world = new World(1, ['bolt', 'nova', 'ember', 'orbit']);

    expect(world.players).toHaveLength(4);
    expect(world.players.map((player) => player.starterId)).toEqual([
      'bolt',
      'nova',
      'ember',
      'orbit',
    ]);
    for (const player of world.players) {
      expect(player.weapons.map((weapon) => weapon.defId)).toEqual([player.starterId]);
    }
  });

  /** Four figures, four silhouettes: a party has to be readable on one screen. */
  it('gives each of them the figure their weapon comes with', () => {
    const world = new World(1, WEAPONS.map((def) => def.id));

    expect(world.players.map((player) => player.sprite)).toEqual(
      WEAPONS.map((def) => def.playerSprite),
    );
  });

  /**
   * The default is the only shape every stand in this project measures, so it
   * has to stay exactly what it was: one player, opening with the bolt.
   */
  it('still makes a solo run when nobody said otherwise', () => {
    const world = new World(7);

    expect(world.players).toHaveLength(1);
    expect(world.players[0].starterId).toBe('bolt');
  });

  /** Loadouts are per player, or a party is one build wearing four hats. */
  it('keeps one player’s levels off another’s weapons', () => {
    const world = party(2, 2);

    world.players[0].weapons[0].level = 5;

    expect(world.players[1].weapons[0].level).toBe(1);
    expect(world.players[0].stacks).not.toBe(world.players[1].stacks);
  });
});

describe('who the horde walks toward', () => {
  it('sends an enemy at the nearest player, not the first one', () => {
    const world = party(3, 2);
    place(world, 0, -500, 0);
    const near = place(world, 1, 60, 0);

    const enemy = grunt(world, 200, 0);
    rebuildGrid(world);
    movementSystem(world, DT);

    expect(enemy.x).toBeLessThan(200);
    expect(nearestPlayer(world, enemy.x, enemy.y)).toBe(near);
  });

  it('switches target when somebody closer walks past', () => {
    const world = party(4, 2);
    place(world, 0, 0, 0);
    place(world, 1, 1000, 0);

    const enemy = grunt(world, 500, 0);
    rebuildGrid(world);
    movementSystem(world, DT);
    const towardFirst = enemy.x;
    expect(towardFirst).toBeLessThan(500);

    place(world, 1, 520, 0);
    movementSystem(world, DT);

    expect(enemy.x).toBeGreaterThan(towardFirst);
  });

  /** A corpse is not a target; the horde has to move on to whoever is left. */
  it('ignores the dead', () => {
    const world = party(5, 2);
    const fallen = place(world, 0, 100, 0);
    const living = place(world, 1, -400, 0);
    fallen.hp = 0;

    expect(nearestPlayer(world, 120, 0)).toBe(living);
    expect(anyAlive(world)).toBe(true);
  });
});

describe('where a wave lands', () => {
  /**
   * The ring hangs on the party rather than on a person. With one player the
   * centroid is that player, which is what keeps every existing table valid;
   * with two it is the ground between them.
   */
  it('centres on the party and averages its heading', () => {
    const world = party(6, 2);
    place(world, 0, -100, 0);
    place(world, 1, 300, 200);
    world.players[0].headingX = 1;
    world.players[1].headingX = 0;
    world.players[1].headingY = 1;

    const anchor = partyAnchor(world);

    expect(anchor.x).toBe(100);
    expect(anchor.y).toBe(100);
    expect(anchor.headingX).toBe(0.5);
    expect(anchor.headingY).toBe(0.5);
  });

  it('reads a solo party as exactly that player', () => {
    const world = party(7, 1);
    place(world, 0, 123.5, -47.25);
    world.players[0].headingX = -0.75;

    const anchor = partyAnchor(world);

    expect(anchor.x).toBe(123.5);
    expect(anchor.y).toBe(-47.25);
    expect(anchor.headingX).toBe(-0.75);
  });

  /**
   * Straying is measured to the nearest player. Measured to one of them, the
   * crowd chasing everybody else would be deleted for standing where it was
   * told to stand — which reads as enemies vanishing rather than as a bug.
   */
  it('keeps a body that is chasing somebody far from the first player', () => {
    const world = party(8, 2);
    place(world, 0, 0, 0);
    place(world, 1, 4000, 0);

    const escort = grunt(world, 4050, 0);
    reapSystem(world);

    expect(world.enemies).toContain(escort);
  });

  it('still recycles one that is far from everybody', () => {
    const world = party(9, 2);
    place(world, 0, 0, 0);
    place(world, 1, 4000, 0);

    grunt(world, 0, CONFIG.spawn.despawnRadius + 50);
    reapSystem(world);

    expect(world.enemies).toHaveLength(0);
  });
});

describe('who takes the hit and who takes the gem', () => {
  it('hurts each player on their own invulnerability window', () => {
    const world = party(10, 2);
    const first = place(world, 0, 0, 0);
    const second = place(world, 1, 800, 0);

    grunt(world, 0, 0);
    grunt(world, 800, 0);
    rebuildGrid(world);
    contactSystem(world);

    expect(first.hp).toBeLessThan(CONFIG.player.maxHp);
    expect(second.hp).toBeLessThan(CONFIG.player.maxHp);
    expect(first.invuln).toBeGreaterThan(0);
    expect(second.invuln).toBeGreaterThan(0);
  });

  it('spares a player whose grace is still running', () => {
    const world = party(11, 2);
    const shielded = place(world, 0, 0, 0);
    const exposed = place(world, 1, 800, 0);
    shielded.invuln = 0.4;

    grunt(world, 0, 0);
    grunt(world, 800, 0);
    rebuildGrid(world);
    contactSystem(world);

    expect(shielded.hp).toBe(CONFIG.player.maxHp);
    expect(exposed.hp).toBeLessThan(CONFIG.player.maxHp);
  });

  /**
   * A gem goes to whoever is nearest and to nobody else. Two players both
   * pulling on one would drag it at twice the magnet speed toward the point
   * between them, and both collecting it would be XP the horde never paid for.
   */
  it('gives a gem to the nearer player, once', () => {
    const world = party(12, 2);
    const near = place(world, 0, 0, 0);
    const far = place(world, 1, 900, 0);

    const gem = world.gemPool.obtain();
    gem.x = 10;
    gem.y = 0;
    gem.px = gem.x;
    gem.py = gem.y;
    gem.value = 3;
    world.gems.push(gem);

    pickupSystem(world, DT);

    expect(near.xp).toBe(3);
    expect(far.xp).toBe(0);
    expect(world.gems).toHaveLength(0);
  });
});

describe('a run with more than one life in it', () => {
  /**
   * The rule for now, and openly a placeholder: nothing in this game heals, so
   * the first of four to fall watches the other three for as long as they last.
   */
  it('ends only when the last player falls', () => {
    const world = party(13, 2);

    damagePlayer(world, world.players[0], 999);
    expect(world.players[0].hp).toBe(0);
    expect(world.phase).toBe('playing');

    damagePlayer(world, world.players[1], 999);
    expect(world.phase).toBe('dead');
    expect(anyAlive(world)).toBe(false);
  });

  it('stops a fallen player’s weapons', () => {
    // Shockwaves rather than bolts: this is about whether a weapon fires at
    // all, and a bolt's answer would be a projectile that still has to fly.
    const world = new World(14, ['nova', 'nova']);
    const fallen = place(world, 0, 0, 0);
    fallen.hp = 0;
    place(world, 1, 900, 0);

    const beside = grunt(world, 30, 0);
    const other = grunt(world, 930, 0);
    rebuildGrid(world);

    for (let tick = 0; tick < 60; tick++) weaponSystem(world, DT);

    expect(beside.hp).toBe(beside.maxHp);
    expect(other.hp).toBeLessThan(other.maxHp);
  });

  /**
   * One menu at a time, and it belongs to somebody in particular. `choosing`
   * is what says who, and spending the level has to spend theirs.
   */
  it('opens the level-up screen for the player who earned it', () => {
    const world = party(15, 2);
    world.players[1].xp = 10_000;

    progressionSystem(world);

    expect(world.phase).toBe('levelup');
    expect(world.choosing).toBe(1);
    expect(world.players[1].offered.length).toBeGreaterThan(0);
    expect(world.players[0].offered).toHaveLength(0);
  });
});

describe('a party stepped through a real run', () => {
  it('keeps four players alive, armed and levelling', () => {
    const world = new World(21, ['bolt', 'nova', 'spear', 'ember']);

    for (let i = 0; i < 4; i++) {
      // Spread out enough to be four positions rather than one, close enough
      // that the shared spawn ring still reaches all of them.
      place(world, i, Math.cos((i * Math.PI) / 2) * 120, Math.sin((i * Math.PI) / 2) * 120);
    }

    for (let tick = 0; tick < 60 * 90; tick++) {
      if (world.phase === 'dead') break;

      if (world.phase === 'levelup') {
        // Anything at all: this is about the machinery surviving four of
        // them, not about playing well.
        const player = world.players[world.choosing];
        applyUpgrade(world, player, player.offered[0].id);
        continue;
      }

      for (let i = 0; i < world.players.length; i++) {
        const angle = tick * 0.02 + (i * Math.PI) / 2;
        world.players[i].intentX = Math.cos(angle);
        world.players[i].intentY = Math.sin(angle);
      }

      stepWorld(world, DT);
    }

    expect(world.kills).toBeGreaterThan(0);
    expect(world.enemies.length).toBeGreaterThan(0);
    // Every player is doing something: earning XP and firing their own weapon.
    for (const player of world.players) {
      expect(player.level, player.starterId).toBeGreaterThan(1);
    }
    // The boss is not part of this window, so nothing here should have spawned
    // one — the run is still the horde.
    expect(world.enemies.some((enemy) => enemy.sprite === BOSS.sprite)).toBe(false);
  });
});
