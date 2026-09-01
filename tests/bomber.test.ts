import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { enemyById } from '../src/data/enemies';
import { createWeaponState, orbitDistance, weaponById } from '../src/data/weapons';
import { reapSystem } from '../src/systems/reap';
import { hordeHpScale, spawnEnemyAt } from '../src/systems/spawn';
import { World } from '../src/world/world';
import type { Enemy } from '../src/world/types';

const BOMBER = enemyById('bomber');
const BRUTE = enemyById('brute');

if (BOMBER?.detonate === undefined || BRUTE === undefined) {
  throw new Error('the enemy table lost the type this file is about');
}

const BLAST = BOMBER.detonate;

function place(world: World, id: string, x: number, y: number): Enemy {
  const def = enemyById(id);
  if (def === undefined) throw new Error(`no enemy '${id}'`);
  spawnEnemyAt(world, def, hordeHpScale(world), x, y);
  return world.enemies[world.enemies.length - 1];
}

/** Just inside the blast, and just outside it. */
const INSIDE = BLAST.radius + CONFIG.player.radius - 2;
const OUTSIDE = BLAST.radius + CONFIG.player.radius + 2;

describe('the bomber', () => {
  it('hits harder than the hardest-hitting body', () => {
    // Under a shared invulnerability window the largest hit in flight wins, so
    // a smaller blast would shield the player rather than hurt them.
    expect(BLAST.damage).toBeGreaterThan(BRUTE.damage);
  });

  it('is killable before it arrives', () => {
    // The choice this enemy asks is which weapon finishes it, which only
    // exists while it is still walking in.
    expect(BOMBER.speed).toBeLessThan(BRUTE.speed + 20);
  });

  /**
   * The whole justification for this enemy, asserted as geometry rather than
   * left to a comment: where each weapon kills, against where the blast
   * reaches. A change to any weapon's reach that quietly moved a build in or
   * out of the blast would land here.
   */
  it('reaches the weapons that kill up close and not the one that kills far off', () => {
    const reach = BLAST.radius + CONFIG.player.radius;

    const bolt = weaponById('bolt');
    if (bolt?.kind !== 'bolt') throw new Error('the bolt stopped being a bolt');
    // Kills at arm's length plus four hundred: never pays.
    expect(bolt.range).toBeGreaterThan(reach * 3);

    const orbit = weaponById('orbit');
    if (orbit?.kind !== 'orbit') throw new Error('the orbit stopped being an orbit');
    // The ring is anchored where contact happens, so it is inside the blast.
    expect(orbitDistance(orbit, createWeaponState('orbit')) + orbit.orbRadius).toBeLessThan(reach);

    const nova = weaponById('nova');
    if (nova?.kind !== 'nova') throw new Error('the nova stopped being a nova');
    // Centred on the player and wider than the blast: it can kill one safely
    // at its edge, which is what makes it the middle case rather than a third
    // copy of the orbit.
    expect(nova.radius).toBeGreaterThan(reach);
  });

  it('costs the player health when it dies in their lap', () => {
    const world = new World(1);
    const bomber = place(world, 'bomber', INSIDE, 0);
    bomber.hp = 0;
    const before = world.players[0].hp;

    reapSystem(world);

    expect(world.players[0].hp).toBe(before - BLAST.damage);
  });

  it('costs nothing when it dies out of reach', () => {
    const world = new World(2);
    const bomber = place(world, 'bomber', OUTSIDE, 0);
    bomber.hp = 0;
    const before = world.players[0].hp;

    reapSystem(world);

    expect(world.players[0].hp).toBe(before);
  });

  it('leaves a ring either way, so the blast is never invisible', () => {
    const world = new World(3);
    place(world, 'bomber', OUTSIDE, 0).hp = 0;

    reapSystem(world);

    expect(world.effects).toHaveLength(1);
    expect(world.effects[0].maxRadius).toBe(BLAST.radius);
  });

  it('does not thin the horde it dies in', () => {
    const world = new World(4);
    const bomber = place(world, 'bomber', 0, 0);
    const neighbour = place(world, 'grunt', 10, 0);
    const hp = neighbour.hp;
    bomber.hp = 0;

    reapSystem(world);

    // A blast that cleared the crowd would make killing bombers good, which is
    // the opposite of why this enemy exists.
    expect(neighbour.hp).toBe(hp);
  });

  it('obeys the invulnerability window like everything else', () => {
    const world = new World(5);
    world.players[0].invuln = CONFIG.player.invulnTime;
    place(world, 'bomber', INSIDE, 0).hp = 0;
    const before = world.players[0].hp;

    reapSystem(world);

    expect(world.players[0].hp).toBe(before);
  });

  it('does not go off for an enemy that simply wandered away', () => {
    const world = new World(6);
    // Past the despawn radius and still alive: recycled, not killed.
    place(world, 'bomber', CONFIG.spawn.despawnRadius + 100, 0);
    const before = world.players[0].hp;

    reapSystem(world);

    expect(world.enemies).toHaveLength(0);
    expect(world.effects).toHaveLength(0);
    expect(world.players[0].hp).toBe(before);
  });

  it('can finish a player who was already hurt', () => {
    const world = new World(7);
    world.players[0].hp = 1;
    place(world, 'bomber', INSIDE, 0).hp = 0;

    reapSystem(world);

    expect(world.players[0].hp).toBe(0);
    expect(world.phase).toBe('dead');
  });

  it('leaves ordinary deaths silent', () => {
    const world = new World(8);
    place(world, 'grunt', INSIDE, 0).hp = 0;
    const before = world.players[0].hp;

    reapSystem(world);

    expect(world.players[0].hp).toBe(before);
    expect(world.effects).toHaveLength(0);
  });
});
