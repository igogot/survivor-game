import { TAU, dist2 } from '../core/math';
import {
  createWeaponState,
  novaRadius,
  orbitCount,
  orbitDistance,
  weaponById,
  weaponDamage,
} from '../data/weapons';
import { damageArea } from './damage';
import { spawnEffect } from './effects';
import type { BoltWeaponDef, NovaWeaponDef, OrbitWeaponDef } from '../data/weapons';
import type { Enemy, WeaponState } from '../world/types';
import type { World } from '../world/world';

/**
 * Every weapon the player owns, advanced once per tick.
 *
 * Weapons fire themselves — the genre's defining choice. The player only
 * decides where to stand, which is why targeting is "nearest enemy in range"
 * and never anything they aim.
 *
 * Each kind gets its own routine and its own cooldown, so a run with three
 * weapons is three independent clocks rather than one shared one.
 */
export function weaponSystem(world: World, dt: number): void {
  const weapons = world.weapons;

  for (let i = 0; i < weapons.length; i++) {
    const state = weapons[i];
    const def = weaponById(state.defId);
    if (def === undefined) continue;

    switch (def.kind) {
      case 'bolt':
        stepBolt(world, def, state, dt);
        break;
      case 'orbit':
        stepOrbit(world, def, state, dt);
        break;
      case 'nova':
        stepNova(world, def, state, dt);
        break;
      default: {
        // Exhaustiveness check: adding a weapon kind without a routine here
        // stops compiling rather than silently doing nothing at runtime.
        const unhandled: never = def;
        throw new Error(`Unhandled weapon kind: ${String(unhandled)}`);
      }
    }
  }
}

/**
 * Grants a weapon, or levels it if the player already owns it.
 *
 * One upgrade card can therefore mean both "new weapon" and "stronger weapon"
 * without the progression system knowing anything about weapons.
 */
export function grantWeapon(world: World, defId: string): void {
  if (weaponById(defId) === undefined) return;

  const owned = world.weapons.find((state) => state.defId === defId);
  if (owned !== undefined) {
    owned.level++;
    return;
  }

  world.weapons.push(createWeaponState(defId));
}

function stepBolt(world: World, def: BoltWeaponDef, state: WeaponState, dt: number): void {
  state.cooldown -= dt;
  if (state.cooldown > 0) return;

  const target = findNearestEnemy(world, def.range);
  if (target === null) return;

  const player = world.player;
  state.cooldown = def.cooldown / player.stats.attackSpeedMul;

  const baseAngle = Math.atan2(target.y - player.y, target.x - player.x);
  const count = player.stats.projectiles;
  const damage = weaponDamage(def, state.level) * player.stats.damageMul;

  for (let i = 0; i < count; i++) {
    // Fan the shots symmetrically around the aim direction.
    const offset = (i - (count - 1) / 2) * def.spread;
    fire(world, def, baseAngle + offset, damage);
  }
}

function stepOrbit(world: World, def: OrbitWeaponDef, state: WeaponState, dt: number): void {
  const player = world.player;

  // The ring keeps turning between damage pulses — it is the weapon's whole
  // visual. The angle is deliberately never wrapped into [0, TAU): the renderer
  // interpolates between `pangle` and `angle`, and a wrap would run that
  // interpolation backwards for one frame every couple of seconds.
  state.pangle = state.angle;
  state.angle += def.spin * dt;

  state.cooldown -= dt;
  if (state.cooldown > 0) return;
  state.cooldown = def.cooldown / player.stats.attackSpeedMul;

  const count = orbitCount(def, state.level);
  const distance = orbitDistance(def, state.level);
  const damage = weaponDamage(def, state.level) * player.stats.damageMul;

  // One event for the whole ring: an enemy caught between two blades takes one
  // hit, not two.
  const event = world.nextDamageEvent();

  for (let i = 0; i < count; i++) {
    const angle = state.angle + (i * TAU) / count;
    damageArea(
      world,
      player.x + Math.cos(angle) * distance,
      player.y + Math.sin(angle) * distance,
      def.orbRadius,
      damage,
      event,
    );
  }
}

function stepNova(world: World, def: NovaWeaponDef, state: WeaponState, dt: number): void {
  state.cooldown -= dt;
  if (state.cooldown > 0) return;

  const player = world.player;
  state.cooldown = def.cooldown / player.stats.attackSpeedMul;

  const radius = novaRadius(def, state.level);
  const damage = weaponDamage(def, state.level) * player.stats.damageMul;

  damageArea(world, player.x, player.y, radius, damage, world.nextDamageEvent());
  spawnEffect(world, player.x, player.y, radius, def.effectLife, def.color);
}

function fire(world: World, def: BoltWeaponDef, angle: number, damage: number): void {
  const player = world.player;
  const projectile = world.projectilePool.obtain();

  projectile.x = player.x;
  projectile.y = player.y;
  projectile.px = projectile.x;
  projectile.py = projectile.y;
  projectile.vx = Math.cos(angle) * def.projectileSpeed;
  projectile.vy = Math.sin(angle) * def.projectileSpeed;
  projectile.damage = damage;
  projectile.radius = def.projectileRadius;
  projectile.life = def.life;
  projectile.pierce = player.stats.pierce;
  projectile.lastHitId = 0;
  projectile.color = def.color;

  world.projectiles.push(projectile);
}

/**
 * Runs once per shot rather than per frame, so scanning the cells inside the
 * weapon's range is cheap enough to keep it simple.
 */
function findNearestEnemy(world: World, range: number): Enemy | null {
  const { player, grid, enemies, scratch } = world;
  grid.query(player.x, player.y, range, scratch);

  let nearest: Enemy | null = null;
  let nearestDistance = range * range;

  for (let i = 0; i < scratch.length; i++) {
    const enemy = enemies[scratch[i]];
    if (enemy === undefined || enemy.hp <= 0) continue;

    const distance = dist2(player.x, player.y, enemy.x, enemy.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = enemy;
    }
  }

  return nearest;
}
