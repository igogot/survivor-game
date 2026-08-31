import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { enemyById } from '../src/data/enemies';
import { enemyAttackSystem } from '../src/systems/enemyAttack';
import { movementSystem } from '../src/systems/movement';
import { projectileSystem } from '../src/systems/projectiles';
import { hordeHpScale, spawnEnemyAt } from '../src/systems/spawn';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import type { Enemy } from '../src/world/types';

const CASTER = enemyById('caster');
const GRUNT = enemyById('grunt');

if (CASTER?.ranged === undefined || GRUNT === undefined) {
  throw new Error('the enemy table lost the type this file is about');
}

const RANGED = CASTER.ranged;
const DT = 1 / CONFIG.tickRate;

function place(world: World, id: string, x: number, y: number): Enemy {
  const def = enemyById(id);
  if (def === undefined) throw new Error(`no enemy '${id}'`);
  spawnEnemyAt(world, def, hordeHpScale(world), x, y);
  const enemy = world.enemies[world.enemies.length - 1];
  // The stagger is random by design; tests want a known clock.
  enemy.attackCooldown = 0;
  return enemy;
}

describe('the caster', () => {
  it('is declared coherently in the table', () => {
    expect(RANGED.range).toBeGreaterThan(CONFIG.player.radius * 4);
    expect(RANGED.cooldown).toBeGreaterThan(0);
    expect(RANGED.projectileSpeed).toBeGreaterThan(0);
    // Its body is not the threat; the hex is.
    expect(RANGED.damage).toBeGreaterThan(CASTER.damage);
  });

  it('throws when its cooldown comes up, and then waits', () => {
    const world = new World(1);
    place(world, 'caster', 300, 0);

    enemyAttackSystem(world, DT);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0].hostile).toBe(true);
    expect(world.projectiles[0].sprite).toBe('hex');

    enemyAttackSystem(world, DT);
    expect(world.projectiles).toHaveLength(1);
  });

  it('staggers its clock on spawn so a batch does not fire as one', () => {
    const world = new World(2);
    const def = enemyById('caster');
    if (def === undefined) throw new Error('no caster');

    const cooldowns = new Set<number>();
    for (let i = 0; i < 8; i++) {
      spawnEnemyAt(world, def, 1, 300, 0);
      cooldowns.add(world.enemies[world.enemies.length - 1].attackCooldown);
    }

    expect(cooldowns.size).toBeGreaterThan(1);
    for (const cooldown of cooldowns) {
      expect(cooldown).toBeGreaterThanOrEqual(0);
      expect(cooldown).toBeLessThanOrEqual(RANGED.cooldown);
    }
  });

  it('holds its distance instead of walking into contact', () => {
    const world = new World(3);
    const caster = place(world, 'caster', RANGED.range + 200, 0);

    for (let i = 0; i < 60 * 20; i++) movementSystem(world, DT);

    const distance = Math.hypot(caster.x - world.player.x, caster.y - world.player.y);
    expect(distance).toBeLessThanOrEqual(RANGED.range + 1);
    expect(distance).toBeGreaterThan(RANGED.range - 5);
  });

  it('leaves ordinary enemies walking all the way in', () => {
    const world = new World(4);
    const grunt = place(world, 'grunt', 400, 0);

    for (let i = 0; i < 60 * 20; i++) movementSystem(world, DT);

    expect(Math.hypot(grunt.x - world.player.x, grunt.y - world.player.y)).toBeLessThan(2);
  });

  it('aims where a moving player is going, not where they are', () => {
    const world = new World(5);
    place(world, 'caster', 0, -400);
    // Moving right at full tilt, heading already settled.
    world.headingX = 1;
    world.headingY = 0;

    enemyAttackSystem(world, DT);

    const hex = world.projectiles[0];
    expect(hex.vx).toBeGreaterThan(0);
    // A shot at the player's current position would be straight down.
    expect(Math.abs(hex.vx)).toBeGreaterThan(RANGED.projectileSpeed * 0.4);
  });

  it('aims straight at a player who is standing still', () => {
    const world = new World(6);
    place(world, 'caster', 0, -400);

    enemyAttackSystem(world, DT);

    const hex = world.projectiles[0];
    expect(Math.abs(hex.vx)).toBeLessThan(0.001);
    expect(hex.vy).toBeCloseTo(RANGED.projectileSpeed);
  });
});

describe('hostile projectiles', () => {
  /** A hex already touching the player. */
  function hexOnPlayer(world: World): void {
    place(world, 'caster', 0, -10);
    enemyAttackSystem(world, DT);
  }

  it('damages the player and is spent', () => {
    const world = new World(7);
    hexOnPlayer(world);
    const before = world.player.hp;

    projectileSystem(world, DT);

    expect(world.player.hp).toBeLessThan(before);
    expect(world.projectiles).toHaveLength(0);
  });

  it('respects the invulnerability window like a body does', () => {
    const world = new World(8);
    world.player.invuln = CONFIG.player.invulnTime;
    hexOnPlayer(world);
    const before = world.player.hp;

    projectileSystem(world, DT);

    expect(world.player.hp).toBe(before);
    // Absorbed rather than passing through: i-frames eat the hex.
    expect(world.projectiles).toHaveLength(0);
  });

  it('never damages the horde it came from', () => {
    const world = new World(9);
    place(world, 'caster', 0, -10);
    const bystander = place(world, 'grunt', 0, -8);
    const hp = bystander.hp;

    enemyAttackSystem(world, DT);
    projectileSystem(world, DT);

    expect(bystander.hp).toBe(hp);
  });

  it('kills the player when the last of their health goes', () => {
    const world = new World(10);
    world.player.hp = 1;
    hexOnPlayer(world);

    projectileSystem(world, DT);

    expect(world.player.hp).toBe(0);
    expect(world.phase).toBe('dead');
  });

  it('does not leak hostility back into the player through the pool', () => {
    const world = new World(11);
    hexOnPlayer(world);
    projectileSystem(world, DT);
    expect(world.projectiles).toHaveLength(0);

    // The next shot out of the pool is the player's, and must be theirs.
    world.enemies.length = 0;
    place(world, 'grunt', 60, 0);
    for (let i = 0; i < 120; i++) stepWorld(world, DT);

    for (const projectile of world.projectiles) {
      expect(projectile.hostile).toBe(false);
      expect(projectile.sprite).toBe('bolt');
    }
  });
});
