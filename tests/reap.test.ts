import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { enemyById } from '../src/data/enemies';
import { reapSystem } from '../src/systems/reap';
import { hordeHpScale, spawnEnemyAt } from '../src/systems/spawn';
import { World } from '../src/world/world';
import type { Enemy } from '../src/world/types';

const SPLITTER = enemyById('splitter');
const SPAWNLING = enemyById('spawnling');
const GRUNT = enemyById('grunt');

if (SPLITTER === undefined || SPAWNLING === undefined || GRUNT === undefined) {
  throw new Error('the enemy table lost a type this file is about');
}

/** Puts one enemy on top of the player, where nothing can despawn it. */
function place(world: World, id: string): Enemy {
  const def = enemyById(id);
  if (def === undefined) throw new Error(`no enemy '${id}'`);
  spawnEnemyAt(world, def, hordeHpScale(world), world.player.x, world.player.y);
  return world.enemies[world.enemies.length - 1];
}

function kill(enemy: Enemy): void {
  enemy.hp = 0;
}

describe('splitting', () => {
  it('is declared coherently in the table', () => {
    expect(SPLITTER.split).toBeDefined();
    expect(SPLITTER.split?.count).toBeGreaterThan(1);
    expect(enemyById(SPLITTER.split?.into ?? '')).toBeDefined();
  });

  it('leaves children where the parent died', () => {
    const world = new World(1);
    const parent = place(world, 'splitter');
    parent.x = 300;
    parent.y = -120;
    kill(parent);

    reapSystem(world);

    expect(world.enemies).toHaveLength(SPLITTER.split?.count ?? 0);
    for (const child of world.enemies) {
      expect(child.defId).toBe('spawnling');
      expect(Math.hypot(child.x - 300, child.y + 120)).toBeLessThanOrEqual(parent.radius + 0.001);
    }
  });

  it('does not stack the children on one point', () => {
    const world = new World(2);
    kill(place(world, 'splitter'));

    reapSystem(world);

    const [a, b] = world.enemies;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('gives the children the horde scale, not a share of the parent', () => {
    const world = new World(3);
    world.time = 600;
    kill(place(world, 'splitter'));

    reapSystem(world);

    for (const child of world.enemies) {
      expect(child.maxHp).toBeCloseTo(SPAWNLING.hp * hordeHpScale(world));
    }
  });

  it('stops there — a child does not split again', () => {
    const world = new World(4);
    kill(place(world, 'splitter'));
    reapSystem(world);

    for (const child of world.enemies) kill(child);
    reapSystem(world);

    expect(world.enemies).toHaveLength(0);
  });

  it('leaves nothing behind for a type that does not split', () => {
    const world = new World(5);
    kill(place(world, 'grunt'));

    reapSystem(world);

    expect(world.enemies).toHaveLength(0);
  });

  it('still drops the parent gem', () => {
    const world = new World(6);
    kill(place(world, 'splitter'));

    reapSystem(world);

    expect(world.gems).toHaveLength(1);
    expect(world.gems[0].value).toBe(SPLITTER.xp);
  });

  it('is not a way around the enemy cap', () => {
    const world = new World(7);
    while (world.enemies.length < CONFIG.spawn.maxEnemies) place(world, 'splitter');
    kill(world.enemies[0]);

    reapSystem(world);

    expect(world.enemies.length).toBeLessThanOrEqual(CONFIG.spawn.maxEnemies);
  });

  /**
   * The guard on the subtle part: children are appended while the removal loop
   * is still running, and that loop removes by overwriting with the last
   * element. If the interaction is wrong, a survivor goes missing or a corpse
   * stays.
   */
  it('loses nobody when several split in the same tick', () => {
    const world = new World(8);
    const survivors = [place(world, 'grunt'), place(world, 'brute')];
    const survivorIds = new Set(survivors.map((enemy) => enemy.id));

    const dying = [place(world, 'splitter'), place(world, 'splitter'), place(world, 'splitter')];
    for (const enemy of dying) kill(enemy);

    reapSystem(world);

    const children = (SPLITTER.split?.count ?? 0) * dying.length;
    expect(world.enemies).toHaveLength(survivors.length + children);
    expect(world.enemies.filter((enemy) => enemy.hp <= 0)).toHaveLength(0);

    const left = new Set(world.enemies.map((enemy) => enemy.id));
    for (const id of survivorIds) expect(left.has(id)).toBe(true);
  });
});
