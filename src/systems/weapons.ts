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
  trailRadius,
  trailSpacing,
  weaponById,
  weaponCooldown,
  weaponDamage,
} from '../data/weapons';
import { damageArea, damageSegment } from './damage';
import { spawnEffect } from './effects';
import { spawnProjectile } from './projectiles';
import { burnTrail, layFlame } from './trail';
import type {
  BoltWeaponDef,
  HarpoonWeaponDef,
  NovaWeaponDef,
  OrbitWeaponDef,
  SpearWeaponDef,
  TrailWeaponDef,
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
      case 'harpoon':
        stepHarpoon(world, def, state, dt);
        break;
      case 'trail':
        stepTrail(world, def, state, dt);
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
    fire(world, def, state, baseAngle + offset, damage, state.pierce);
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

function stepHarpoon(
  world: World,
  def: HarpoonWeaponDef,
  state: WeaponState,
  dt: number,
): void {
  state.cooldown -= dt;
  if (state.cooldown > 0) return;

  // Nothing in range means the shot is not spent. The slowest reload in the
  // game would otherwise be halfway through it when the wave arrives.
  const target = findHeaviestEnemy(world, def.range);
  if (target === null) return;

  const player = world.player;
  state.cooldown = weaponCooldown(def, state, player.stats.attackSpeedMul);

  const angle = Math.atan2(target.y - player.y, target.x - player.x);
  // The spike is a line as much as a hit: the fattest body is usually deep in
  // the wall, so what it passes through on the way is most of what it kills.
  fire(
    world,
    def,
    state,
    angle,
    weaponDamage(def, state) * player.stats.damageMul,
    state.pierce + def.pierce,
  );
}

/**
 * The trail: lay fire where the player has been, and burn what is standing in
 * it.
 *
 * Two clocks, and they are deliberately not the same one. Patches go down by
 * distance covered, so the ribbon is continuous whether the player is walking
 * or sprinting and there is none of it at all while they stand still. The burn
 * runs on the weapon's cooldown like every other weapon, which is what makes
 * Quick Hands and White Heat mean the obvious thing: the fire bites more often
 * rather than the trail growing longer.
 *
 * Splitting them is also what stops the weapon paying twice for speed. Laying
 * on the cooldown would have made a faster player lay a longer trail *and* burn
 * more often, so Light Boots would have been the trail's best damage card by
 * some distance.
 */
function stepTrail(world: World, def: TrailWeaponDef, state: WeaponState, dt: number): void {
  const player = world.player;
  const radius = trailRadius(def, state);
  const spacing = trailSpacing(def, state);

  // One patch at most per tick. The gap the player opens in a single tick is
  // under five pixels even with every boot bought, against a spacing of at
  // least twenty — so a tick can never owe the trail two patches.
  if (dist2(state.trailX, state.trailY, player.x, player.y) >= spacing * spacing) {
    // Only on success: a trail stopped by the cap resumes from where it
    // stopped rather than teleporting to wherever the player has reached.
    if (layFlame(world, player.x, player.y, radius, def.life, def.color)) {
      state.trailX = player.x;
      state.trailY = player.y;
    }
  }

  state.cooldown -= dt;
  if (state.cooldown > 0) return;
  state.cooldown = weaponCooldown(def, state, player.stats.attackSpeedMul);

  burnTrail(world, weaponDamage(def, state) * player.stats.damageMul, world.nextDamageEvent());
}

/**
 * The one selector here that is not "nearest".
 *
 * Weight is `maxHp` and not what the enemy has left: a boss worked down to a
 * brute's remaining hp is still the body worth spiking, and a selector that
 * changed its mind mid-duel would spend the slowest weapon in the game on the
 * escort. Ties break to the nearest, which is what keeps the pick deterministic
 * when a dozen grunts share a spawn's stats.
 */
function findHeaviestEnemy(world: World, range: number): Enemy | null {
  const { player, grid, enemies, scratch } = world;
  grid.query(player.x, player.y, range, scratch);

  const limit = range * range;
  let best: Enemy | null = null;
  let bestWeight = 0;
  let bestDistance = 0;

  for (let i = 0; i < scratch.length; i++) {
    const enemy = enemies[scratch[i]];
    if (enemy === undefined || enemy.hp <= 0) continue;

    const distance = dist2(player.x, player.y, enemy.x, enemy.y);
    if (distance > limit) continue;
    if (enemy.maxHp < bestWeight) continue;
    if (enemy.maxHp === bestWeight && distance >= bestDistance) continue;

    best = enemy;
    bestWeight = enemy.maxHp;
    bestDistance = distance;
  }

  return best;
}

/**
 * The two weapons that put a projectile in the world share this; everything
 * `fire` reads is common to both, and a second copy is exactly where the bolt
 * and the harpoon would drift apart.
 */
type ProjectileWeaponDef = BoltWeaponDef | HarpoonWeaponDef;

function fire(
  world: World,
  def: ProjectileWeaponDef,
  state: WeaponState,
  angle: number,
  damage: number,
  pierce: number,
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
  projectile.pierce = pierce;
  projectile.lastHitId = 0;
  projectile.color = def.color;
  // Written rather than assumed: the pool hands back whatever the last shot
  // left, and the last shot may well have belonged to the horde.
  projectile.hostile = false;
  projectile.sprite = def.sprite;
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
