import { CONFIG } from '../config';
import { BOSS, ENEMIES } from '../data/enemies';
import { bossAbilityById } from '../data/bossAbilities';
import { damagePlayer } from './damage';
import { dist2 } from '../core/math';
import { hurlHex } from './enemyAttack';
import { nearestPlayer } from '../world/party';
import { spawnEffect } from './effects';
import { spawnEnemyAt } from './spawn';
import type { BossAbilityDef } from '../data/bossAbilities';
import type { Enemy } from '../world/types';
import type { World } from '../world/world';

/**
 * What a boss does that a grunt cannot.
 *
 * Runs in the combat half of the tick beside `enemyAttackSystem`, and for the
 * same reason: it adds projectiles and enemies rather than moving anybody, so
 * no broad-phase index is disturbed under an iteration.
 *
 * Not everything is here. `ward` opens its window here but refuses damage in
 * `applyDamage`, and `thorns` lives there entirely: both are about a hit
 * arriving rather than about the boss's own clock, and the number they change
 * only exists at the moment it lands.
 */

/** Speed of a hex the boss throws, and how long one lives. */
const HEX_SPEED = 240;
const HEX_LIFE = 3.2;
const HEX_RADIUS = 8;
/** What one of the boss's shots costs the player. */
const HEX_DAMAGE = 22;

/** How far from the boss its summons appear. */
const SUMMON_RING = 90;

/** What the quake reaches, and how long its ring is drawn for. */
const QUAKE_RADIUS = 190;
const QUAKE_EFFECT_LIFE = 0.4;

export function bossAbilitySystem(world: World, dt: number): void {
  const enemies = world.enemies;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    // Cheap gate: everything in the horde is not a boss, and the flag is one
    // comparison against a field the spawner already writes.
    if (!enemy.boss || enemy.hp <= 0) continue;

    const ability = bossAbilityById(enemy.ability);
    if (ability === undefined) continue;

    if (enemy.abilityTimer > 0) {
      enemy.abilityTimer = Math.max(0, enemy.abilityTimer - dt);
      if (enemy.abilityTimer === 0) endEffect(enemy, ability);
    }

    if (ability.kind === 'passive') {
      runPassive(world, enemy, ability, dt);
      continue;
    }

    enemy.attackCooldown -= dt;
    if (enemy.attackCooldown > 0) continue;
    enemy.attackCooldown = ability.cooldown;

    use(world, enemy, ability);
  }
}

/**
 * The abilities that are simply true rather than used.
 *
 * `thorns` is passive as well and is absent: it does its work inside
 * `applyDamage`, where the hit it answers actually arrives.
 */
function runPassive(world: World, enemy: Enemy, ability: BossAbilityDef, dt: number): void {
  switch (ability.id) {
    case 'enrage': {
      // Recomputed from the definition every tick rather than accumulated, so
      // a boss healed by anything cools down again instead of keeping speed it
      // no longer deserves.
      const hurt = 1 - enemy.hp / enemy.maxHp;
      enemy.speed = BOSS.speed * (1 + ability.power * hurt);
      break;
    }
    case 'leech': {
      const player = nearestPlayer(world, enemy.x, enemy.y);
      if (player === null || player.hp <= 0) break;

      // Only while it is actually touching somebody. A boss that healed at
      // range would simply be a boss with more health, and the player would
      // have no way to argue with it.
      const reach = enemy.radius + CONFIG.player.radius;
      if (dist2(enemy.x, enemy.y, player.x, player.y) > reach * reach) break;

      enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * ability.power * dt);
      break;
    }
    default:
      break;
  }
}

function use(world: World, enemy: Enemy, ability: BossAbilityDef): void {
  switch (ability.id) {
    case 'charge':
      enemy.speed = BOSS.speed * ability.power;
      enemy.abilityTimer = ability.duration;
      break;

    case 'summon':
      summon(world, enemy, ability);
      break;

    case 'volley':
      for (let i = 0; i < ability.power; i++) {
        hurlHex(world, enemy, {
          projectileSpeed: HEX_SPEED,
          projectileRadius: HEX_RADIUS,
          damage: HEX_DAMAGE,
          life: HEX_LIFE,
          // Every shot of the volley is aimed at the same lead, so the three of
          // them arrive as a line the player can be on the wrong side of rather
          // than as three separate guesses.
          spread: (i - (ability.power - 1) / 2) * 0.12,
        });
      }
      break;

    case 'burst':
      for (let i = 0; i < ability.power; i++) {
        hurlHex(world, enemy, {
          projectileSpeed: HEX_SPEED,
          projectileRadius: HEX_RADIUS,
          damage: HEX_DAMAGE,
          life: HEX_LIFE,
          // Around the compass rather than at anybody: a ring has no aim to
          // beat, only a distance to be at.
          absolute: (i * Math.PI * 2) / ability.power,
        });
      }
      break;

    case 'quake':
      quake(world, enemy, ability);
      break;

    case 'blink':
      blink(world, enemy, ability);
      break;

    case 'ward':
      // The whole ability is the window. What it does inside it happens in
      // `applyDamage`, which is where the damage it refuses actually arrives.
      enemy.abilityTimer = ability.duration;
      break;

    default:
      break;
  }
}

/** Puts the boss back to what it was when a timed effect runs out. */
function endEffect(enemy: Enemy, ability: BossAbilityDef): void {
  if (ability.id === 'charge') enemy.speed = BOSS.speed;
}

/**
 * Bodies around the boss, on a ring rather than on top of it.
 *
 * They are the horde's own weakest type at the boss's own health scale, so a
 * summon is a wall to walk around rather than a second fight — the fight is
 * still the boss.
 */
function summon(world: World, enemy: Enemy, ability: BossAbilityDef): void {
  const def = ENEMIES[0];
  if (def === undefined) return;

  const scale = enemy.maxHp / BOSS.hp;

  for (let i = 0; i < ability.power; i++) {
    const angle = (i * Math.PI * 2) / ability.power;
    spawnEnemyAt(
      world,
      def,
      scale,
      enemy.x + Math.cos(angle) * SUMMON_RING,
      enemy.y + Math.sin(angle) * SUMMON_RING,
    );
  }
}

/**
 * Everything standing close enough takes it at once.
 *
 * The ring is drawn from the same radius the damage used, because a tell that
 * does not match its reach teaches the player the wrong distance.
 */
function quake(world: World, enemy: Enemy, ability: BossAbilityDef): void {
  spawnEffect(world, enemy.x, enemy.y, QUAKE_RADIUS, QUAKE_EFFECT_LIFE, enemy.color);

  const players = world.players;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.hp <= 0) continue;

    const reach = QUAKE_RADIUS + CONFIG.player.radius;
    if (dist2(enemy.x, enemy.y, player.x, player.y) > reach * reach) continue;

    damagePlayer(world, player, ability.power);
  }
}

/**
 * Arrives beside the nearest player rather than on them.
 *
 * Landing on top of somebody would be a hit they had no way to answer, and the
 * invulnerability window would swallow it anyway — so it lands just outside
 * touching range and has to take the last step itself.
 */
function blink(world: World, enemy: Enemy, ability: BossAbilityDef): void {
  const player = nearestPlayer(world, enemy.x, enemy.y);
  if (player === null || player.hp <= 0) return;

  const dx = enemy.x - player.x;
  const dy = enemy.y - player.y;
  const distance = Math.hypot(dx, dy);
  const reach = enemy.radius + CONFIG.player.radius + ability.power;

  // Keeps whichever side it was already on: a boss that always reappeared to
  // the east would be dodged by always running west.
  const ux = distance < 0.001 ? 1 : dx / distance;
  const uy = distance < 0.001 ? 0 : dy / distance;

  enemy.x = player.x + ux * reach;
  enemy.y = player.y + uy * reach;
  // The renderer interpolates from the previous position, and a blink that
  // interpolated would be a very fast walk.
  enemy.px = enemy.x;
  enemy.py = enemy.y;
}
