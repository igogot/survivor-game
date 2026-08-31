import { TAU, dist2 } from '../core/math';
import {
  createWeaponState,
  novaRadius,
  orbitCount,
  orbitDistance,
  orbitRadius,
  orbitSpin,
  spearLength,
  spearThickness,
  weaponById,
  weaponCooldown,
  weaponDamage,
} from '../data/weapons';
import { damageArea, damageSegment } from './damage';
import { spawnEffect } from './effects';
import { spawnProjectile } from './projectiles';
import type {
  BoltWeaponDef,
  NovaWeaponDef,
  OrbitWeaponDef,
  SpearWeaponDef,
} from '../data/weapons';
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
      case 'spear':
        stepSpear(world, def, state, dt);
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
  state.cooldown = weaponCooldown(def, state, player.stats.attackSpeedMul);

  const baseAngle = Math.atan2(target.y - player.y, target.x - player.x);
  const count = state.projectiles;
  const damage = weaponDamage(def, state) * player.stats.damageMul;

  for (let i = 0; i < count; i++) {
    // Fan the shots symmetrically around the aim direction.
    const offset = (i - (count - 1) / 2) * def.spread;
    fire(world, def, state, baseAngle + offset, damage);
  }
}

function stepOrbit(world: World, def: OrbitWeaponDef, state: WeaponState, dt: number): void {
  const player = world.player;

  // The ring keeps turning between damage pulses — it is the weapon's whole
  // visual. The angle is deliberately never wrapped into [0, TAU): the renderer
  // interpolates between `pangle` and `angle`, and a wrap would run that
  // interpolation backwards for one frame every couple of seconds.
  state.pangle = state.angle;
  state.angle += orbitSpin(def, state) * dt;

  state.cooldown -= dt;
  if (state.cooldown > 0) return;
  state.cooldown = weaponCooldown(def, state, player.stats.attackSpeedMul);

  const count = orbitCount(def, state);
  const distance = orbitDistance(def, state);
  const radius = orbitRadius(def, state);
  const damage = weaponDamage(def, state) * player.stats.damageMul;

  // One event for the whole ring: an enemy caught between two blades takes one
  // hit, not two.
  const event = world.nextDamageEvent();

  for (let i = 0; i < count; i++) {
    const angle = state.angle + (i * TAU) / count;
    damageArea(
      world,
      player.x + Math.cos(angle) * distance,
      player.y + Math.sin(angle) * distance,
      radius,
      damage,
      event,
    );
  }
}

function stepNova(world: World, def: NovaWeaponDef, state: WeaponState, dt: number): void {
  state.cooldown -= dt;
  if (state.cooldown > 0) return;

  const player = world.player;
  state.cooldown = weaponCooldown(def, state, player.stats.attackSpeedMul);

  const radius = novaRadius(def, state);
  const damage = weaponDamage(def, state) * player.stats.damageMul;

  damageArea(world, player.x, player.y, radius, damage, world.nextDamageEvent());
  spawnEffect(world, player.x, player.y, radius, def.effectLife, def.color);
}

function stepSpear(world: World, def: SpearWeaponDef, state: WeaponState, dt: number): void {
  // The lance fades on its own clock, so a slow weapon does not leave one
  // hanging on screen until the next thrust.
  if (state.swing > 0) state.swing = Math.max(0, state.swing - dt);

  state.cooldown -= dt;
  if (state.cooldown > 0) return;

  // Nothing in reach means the thrust is not spent: the lance stays cocked and
  // lands the instant something walks into it.
  const length = spearLength(def, state);
  const target = findNearestEnemy(world, length);
  if (target === null) return;

  const player = world.player;
  state.cooldown = weaponCooldown(def, state, player.stats.attackSpeedMul);
  state.angle = Math.atan2(target.y - player.y, target.x - player.x);
  state.swing = def.swingTime;

  const dx = Math.cos(state.angle);
  const dy = Math.sin(state.angle);

  // One event for the whole lance: an enemy the line passes through is hit
  // once, however long the line is.
  damageSegment(
    world,
    player.x,
    player.y,
    dx,
    dy,
    length,
    spearThickness(def, state),
    weaponDamage(def, state) * player.stats.damageMul,
    world.nextDamageEvent(),
  );
}

function fire(
  world: World,
  def: BoltWeaponDef,
  state: WeaponState,
  angle: number,
  damage: number,
): void {
  const player = world.player;
  const projectile = spawnProjectile(world);

  projectile.x = player.x;
  projectile.y = player.y;
  projectile.px = projectile.x;
  projectile.py = projectile.y;
  projectile.vx = Math.cos(angle) * def.projectileSpeed;
  projectile.vy = Math.sin(angle) * def.projectileSpeed;
  projectile.damage = damage;
  projectile.radius = def.projectileRadius * state.areaMul;
  projectile.life = def.life;
  projectile.pierce = state.pierce;
  projectile.lastHitId = 0;
  projectile.color = def.color;
  // Written rather than assumed: the pool hands back whatever the last shot
  // left, and the last shot may well have belonged to the horde.
  projectile.hostile = false;
  projectile.sprite = 'bolt';
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
