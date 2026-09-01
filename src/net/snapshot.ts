import { BOSS, ENEMIES } from '../data/enemies';
import { SPRITE_NAMES, spriteIndex } from '../data/sprites';
import { SPOILS } from '../data/spoils';
import { UPGRADES } from '../data/upgrades';
import { WEAPONS, createWeaponState, weaponById } from '../data/weapons';
import { FLASH_TIME } from '../systems/damage';
import type { EnemyDef } from '../data/enemies';
import type { World } from '../world/world';

/**
 * The world on a wire.
 *
 * The host is the only machine that steps a `World`; everybody else is handed
 * what it looks like, twenty times a second, and draws that. So this file is
 * the whole contract between them: what a guest can see is exactly what fits in
 * here, and anything the renderer reads and this does not carry is a thing that
 * will be missing on three screens out of four.
 *
 * Binary rather than JSON, and not for elegance. A mid-run field is six hundred
 * enemies; as JSON that is forty kilobytes a frame and eight hundred a second,
 * which no home upstream carries for three guests. Packed the way it is below it
 * is under four, which `tests/snapshot.test.ts` measures rather than assumes.
 *
 * Two ideas do most of that work:
 *
 *   1. **Send names, not properties.** An enemy travels as one byte saying
 *      which `EnemyDef` it is. Its radius, colour, sprite and damage are all
 *      that definition's, and both machines already have the table — sending
 *      them would be sending the game's own data back to itself sixty times a
 *      minute.
 *   2. **Send offsets, not coordinates.** The arena is unbounded, so absolute
 *      positions need floats. Everything in a snapshot is within a screen or
 *      two of somebody, so one float pair of origin buys `int16` for every
 *      position after it, at a quarter of a world unit.
 *
 * What is deliberately *not* here is anything only the host needs: the pools,
 * the broad-phase, the RNG, the spawn timers. A guest's `World` is a mailbox
 * that happens to have the shape of a world, and it is never stepped.
 */

/**
 * How far from the nearest player something has to be to be left out.
 *
 * A screen is about twelve hundred units across at this zoom, so this is a
 * screen and a half in every direction — enough that nothing pops into
 * existence at the edge of anybody's view.
 *
 * It matters for one entity type far more than the rest. Gems are never
 * removed except by being collected, so a long run leaves hundreds of them
 * scattered over every metre it covered; without this a snapshot would grow all
 * run and spend most of itself on treasure nobody can see. The rest of the
 * world is already bounded — enemies despawn at 1500 — so for them this is a
 * cheap check that almost never fires.
 */
export const VIEW_RADIUS = 1800;

/** Quarter-unit precision, which is a tenth of the smallest thing on screen. */
const POSITION_SCALE = 4;

/** Milliseconds, for the short timers that ride along as `uint16`. */
const MS = 1000;

/** Thousandths, for the per-weapon multipliers the renderer reads. */
const MILLI = 1000;

const PHASES = ['playing', 'levelup', 'chest', 'paused', 'dead'] as const;

/** `World.choosing` is -1 for nobody, which does not fit in a byte. */
const NOBODY_WIRE = 255;

/** Every enemy definition in one list, so a body travels as an index into it. */
const ENEMY_DEFS: readonly EnemyDef[] = [...ENEMIES, BOSS];

/**
 * A cursor over a buffer, so the two halves of this file read as a list of
 * fields rather than as arithmetic on byte offsets.
 */
class Writer {
  private readonly view: DataView;
  private at = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(value: number): void {
    this.view.setUint8(this.at, value & 0xff);
    this.at += 1;
  }

  u16(value: number): void {
    this.view.setUint16(this.at, Math.max(0, Math.min(0xffff, Math.round(value))));
    this.at += 2;
  }

  i16(value: number): void {
    this.view.setInt16(this.at, Math.max(-32768, Math.min(32767, Math.round(value))));
    this.at += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.at, value >>> 0);
    this.at += 4;
  }

  f32(value: number): void {
    this.view.setFloat32(this.at, value);
    this.at += 4;
  }

  f64(value: number): void {
    this.view.setFloat64(this.at, value);
    this.at += 8;
  }

  /**
   * Writes a count that is only known after the things it counts.
   *
   * Culling means the number of enemies in a snapshot is not the number in the
   * world, and finding it out beforehand means walking them twice. Reserving
   * two bytes and filling them in afterwards walks them once.
   */
  at16(body: () => number): void {
    const slot = this.at;
    this.at += 2;
    const count = body();
    this.view.setUint16(slot, count);
  }

  /**
   * The bytes written, as their own array.
   *
   * A copy rather than a view onto the scratch buffer, and the copy is the
   * point: a transport is allowed to hold a message before it sends it, and a
   * view would quietly become the *next* snapshot in the meantime. One
   * allocation of a few kilobytes twenty times a second is a price worth paying
   * for a bug that would only ever appear over a real connection.
   */
  done(): Uint8Array {
    return this.bytes.slice(0, this.at);
  }
}

class Reader {
  private readonly view: DataView;
  private at = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    const value = this.view.getUint8(this.at);
    this.at += 1;
    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.at);
    this.at += 2;
    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.at);
    this.at += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.at);
    this.at += 4;
    return value;
  }

  f32(): number {
    const value = this.view.getFloat32(this.at);
    this.at += 4;
    return value;
  }

  f64(): number {
    const value = this.view.getFloat64(this.at);
    this.at += 8;
    return value;
  }
}

/**
 * Room for the largest snapshot the game can produce.
 *
 * Allocated once and written into every time, so encoding does not build a
 * sixty-four kilobyte buffer per frame to fill four of it. What leaves this
 * file is a copy cut to size — see `done`.
 */
const SCRATCH = new Uint8Array(64 * 1024);

/** Whether anything at `x, y` is close enough to somebody to be worth sending. */
function visible(world: World, x: number, y: number): boolean {
  const players = world.players;
  const reach = VIEW_RADIUS * VIEW_RADIUS;

  for (let i = 0; i < players.length; i++) {
    const dx = players[i].x - x;
    const dy = players[i].y - y;
    if (dx * dx + dy * dy <= reach) return true;
  }

  return false;
}

export function encodeSnapshot(world: World): Uint8Array {
  const out = new Writer(SCRATCH);

  // The origin every position below is measured from. Rounded to whole units
  // so that a still world encodes to the same bytes twice running.
  const originX = Math.round(world.players[0]?.x ?? 0);
  const originY = Math.round(world.players[0]?.y ?? 0);
  out.f32(originX);
  out.f32(originY);

  const relX = (x: number): number => (x - originX) * POSITION_SCALE;
  const relY = (y: number): number => (y - originY) * POSITION_SCALE;

  // The run itself. `time` is a double because it is the clock everything else
  // is timed against, and a run has no length to bound it.
  out.f64(world.time);
  out.u32(world.kills);
  out.u16(world.level);
  out.u32(world.xp);
  out.u8(PHASES.indexOf(world.phase));
  out.u8(world.bossesKilled);
  out.u8(world.bossSpawned ? 1 : 0);
  out.f32(world.nextBossAt);

  const players = world.players;
  out.u8(players.length);
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    out.i16(relX(player.x));
    out.i16(relY(player.y));
    out.u16(Math.max(0, player.hp));
    out.u16(player.stats.maxHp);
    out.u8(spriteIndex(player.sprite));
    out.u16(player.invuln * MS);
    out.f32(player.respawnAt);
    out.u8(player.watching);

    // Enough of each weapon to draw it: the ring's blades and the lance's
    // reach are recomputed on the client from exactly these numbers, which is
    // the same guarantee the renderer already keeps locally — a blade hits
    // where it is drawn because both sides do the same arithmetic.
    out.u8(player.weapons.length);
    for (const weapon of player.weapons) {
      out.u8(WEAPONS.findIndex((def) => def.id === weapon.defId));
      out.u8(weapon.level);
      out.f32(weapon.angle);
      out.f32(weapon.pangle);
      out.u16(weapon.swing * MS);
      out.u16(weapon.areaMul * MILLI);
      out.u16(weapon.spinMul * MILLI);
    }
  }

  const enemies = world.enemies;
  out.at16(() => {
    let sent = 0;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!visible(world, enemy.x, enemy.y)) continue;

      out.i16(relX(enemy.x));
      out.i16(relY(enemy.y));
      out.u8(Math.max(0, ENEMY_DEFS.findIndex((def) => def.id === enemy.defId)));
      out.u8((enemy.flash / FLASH_TIME) * 255);
      // A fraction rather than the number: only the boss's bar reads it, and a
      // bar is a fraction.
      out.u8((Math.max(0, enemy.hp) / Math.max(1, enemy.maxHp)) * 255);
      sent++;
    }
    return sent;
  });

  const projectiles = world.projectiles;
  out.at16(() => {
    let sent = 0;
    for (const shot of projectiles) {
      if (!visible(world, shot.x, shot.y)) continue;

      out.i16(relX(shot.x));
      out.i16(relY(shot.y));
      out.i16(shot.vx);
      out.i16(shot.vy);
      out.u8(spriteIndex(shot.sprite));
      out.u8(shot.radius * 2);
      out.u32(shot.color);
      sent++;
    }
    return sent;
  });

  out.at16(() => {
    let sent = 0;
    for (const gem of world.gems) {
      if (!visible(world, gem.x, gem.y)) continue;

      out.i16(relX(gem.x));
      out.i16(relY(gem.y));
      out.u8(Math.min(255, gem.value));
      sent++;
    }
    return sent;
  });

  out.at16(() => {
    let sent = 0;
    for (const effect of world.effects) {
      out.i16(relX(effect.x));
      out.i16(relY(effect.y));
      out.u16(effect.radius * POSITION_SCALE);
      out.u16(effect.maxRadius * POSITION_SCALE);
      out.u16(effect.life * MS);
      out.u16(effect.maxLife * MS);
      out.u32(effect.color);
      sent++;
    }
    return sent;
  });

  out.at16(() => {
    let sent = 0;
    for (const flame of world.flames) {
      if (!visible(world, flame.x, flame.y)) continue;

      out.i16(relX(flame.x));
      out.i16(relY(flame.y));
      out.u16(flame.radius * POSITION_SCALE);
      out.u16(flame.life * MS);
      out.u16(flame.maxLife * MS);
      out.u32(flame.color);
      sent++;
    }
    return sent;
  });

  const chest = world.chest;
  out.u8(chest === null ? 0 : 1);
  if (chest !== null) {
    out.i16(relX(chest.x));
    out.i16(relY(chest.y));
  }

  // Whichever menu is up, and whose it is. A guest has to be able to draw the
  // cards it is being asked to pick from, and the cards are the host's roll —
  // rolling them again on the client would be a second draw from a PRNG the
  // client does not have.
  out.u8(world.choosing < 0 ? NOBODY_WIRE : world.choosing);
  const chooser = world.players[world.choosing];
  const offered = chooser?.offered ?? [];
  out.u8(offered.length);
  for (const card of offered) out.u8(UPGRADES.findIndex((entry) => entry.id === card.id));

  out.u8(world.spoils.length);
  for (const spoil of world.spoils) out.u8(SPOILS.findIndex((entry) => entry.id === spoil.id));

  return out.done();
}

/**
 * Fills a world from a snapshot.
 *
 * The world handed in is a mailbox rather than a simulation: it is never
 * stepped, its pools are used the way the host's are so that nothing allocates
 * per frame, and every array it holds is replaced wholesale. What it is *not*
 * is patched — a snapshot is the whole picture, which is what makes joining a
 * run in progress require no special case at all.
 *
 * Positions carry over into `px`/`py` before they are overwritten, so the
 * renderer's own interpolation smooths the gap between snapshots for free. That
 * is the whole of this client's smoothing, and it is why twenty frames a second
 * of state look like sixty on screen.
 */
export function applySnapshot(world: World, bytes: Uint8Array): void {
  const read = new Reader(bytes);

  const originX = read.f32();
  const originY = read.f32();
  const absX = (value: number): number => originX + value / POSITION_SCALE;
  const absY = (value: number): number => originY + value / POSITION_SCALE;

  world.time = read.f64();
  world.kills = read.u32();
  world.level = read.u16();
  world.xp = read.u32();
  world.phase = PHASES[read.u8()] ?? 'playing';
  world.bossesKilled = read.u8();
  world.bossSpawned = read.u8() === 1;
  world.nextBossAt = read.f32();

  const playerCount = read.u8();
  while (world.players.length < playerCount) world.players.push(blankPlayer(world));
  world.players.length = playerCount;

  for (let i = 0; i < playerCount; i++) {
    const player = world.players[i];
    player.px = player.x;
    player.py = player.y;
    player.x = absX(read.i16());
    player.y = absY(read.i16());
    player.hp = read.u16();
    player.stats.maxHp = read.u16();
    player.sprite = SPRITE_NAMES[read.u8()];
    player.invuln = read.u16() / MS;
    player.respawnAt = read.f32();
    player.watching = read.u8();

    const weaponCount = read.u8();
    player.weapons.length = 0;
    for (let w = 0; w < weaponCount; w++) {
      const def = WEAPONS[read.u8()];
      const state = createWeaponState(def?.id ?? WEAPONS[0].id);
      state.level = read.u8();
      state.angle = read.f32();
      state.pangle = read.f32();
      state.swing = read.u16() / MS;
      state.areaMul = read.u16() / MILLI;
      state.spinMul = read.u16() / MILLI;
      player.weapons.push(state);
    }
  }

  const enemyCount = read.u16();
  recycle(world.enemies, world.enemyPool, enemyCount);
  for (let i = 0; i < enemyCount; i++) {
    const enemy = world.enemies[i];
    enemy.px = enemy.x;
    enemy.py = enemy.y;
    enemy.x = absX(read.i16());
    enemy.y = absY(read.i16());

    const def = ENEMY_DEFS[read.u8()] ?? ENEMY_DEFS[0];
    enemy.defId = def.id;
    enemy.sprite = def.sprite;
    enemy.color = def.color;
    enemy.radius = def.radius;
    enemy.boss = def.id === BOSS.id;

    enemy.flash = (read.u8() / 255) * FLASH_TIME;
    // Rebuilt as a fraction of a nominal bar, because a fraction is all that is
    // sent and all the boss bar reads.
    enemy.maxHp = 1;
    enemy.hp = read.u8() / 255;
  }

  const shotCount = read.u16();
  recycle(world.projectiles, world.projectilePool, shotCount);
  for (let i = 0; i < shotCount; i++) {
    const shot = world.projectiles[i];
    shot.px = shot.x;
    shot.py = shot.y;
    shot.x = absX(read.i16());
    shot.y = absY(read.i16());
    shot.vx = read.i16();
    shot.vy = read.i16();
    shot.sprite = SPRITE_NAMES[read.u8()];
    shot.radius = read.u8() / 2;
    shot.color = read.u32();
  }

  const gemCount = read.u16();
  recycle(world.gems, world.gemPool, gemCount);
  for (let i = 0; i < gemCount; i++) {
    const gem = world.gems[i];
    gem.px = gem.x;
    gem.py = gem.y;
    gem.x = absX(read.i16());
    gem.y = absY(read.i16());
    gem.value = read.u8();
  }

  const effectCount = read.u16();
  recycle(world.effects, world.effectPool, effectCount);
  for (let i = 0; i < effectCount; i++) {
    const effect = world.effects[i];
    effect.pradius = effect.radius;
    effect.x = absX(read.i16());
    effect.y = absY(read.i16());
    effect.radius = read.u16() / POSITION_SCALE;
    effect.maxRadius = read.u16() / POSITION_SCALE;
    effect.life = read.u16() / MS;
    effect.maxLife = read.u16() / MS;
    effect.color = read.u32();
  }

  const flameCount = read.u16();
  recycle(world.flames, world.flamePool, flameCount);
  for (let i = 0; i < flameCount; i++) {
    const flame = world.flames[i];
    flame.x = absX(read.i16());
    flame.y = absY(read.i16());
    flame.radius = read.u16() / POSITION_SCALE;
    flame.life = read.u16() / MS;
    flame.maxLife = read.u16() / MS;
    flame.color = read.u32();
  }

  world.chest = read.u8() === 1 ? { x: absX(read.i16()), y: absY(read.i16()) } : null;

  const choosing = read.u8();
  world.choosing = choosing === NOBODY_WIRE ? -1 : choosing;
  const offered = new Array(read.u8()).fill(null).map(() => UPGRADES[read.u8()]);
  for (const player of world.players) player.offered = [];
  const chooser = world.players[world.choosing];
  if (chooser !== undefined) chooser.offered = offered.filter((card) => card !== undefined);

  world.spoils = new Array(read.u8())
    .fill(null)
    .map(() => SPOILS[read.u8()])
    .filter((spoil) => spoil !== undefined);
}

/**
 * Grows or shrinks a pooled array to exactly `count` entries.
 *
 * Through the pool rather than by building objects, so a guest allocates as
 * little per frame as the host does — the same reason `src/core/pool.ts` exists
 * at all.
 */
function recycle<T>(
  list: T[],
  pool: { obtain: () => T; release: (item: T) => void },
  count: number,
): void {
  while (list.length > count) {
    const spare = list.pop();
    if (spare !== undefined) pool.release(spare);
  }
  while (list.length < count) list.push(pool.obtain());
}

/** A player to pour a snapshot into. Every field of it is about to be replaced. */
function blankPlayer(world: World): World['players'][number] {
  const template = world.players[0];
  return {
    ...template,
    weapons: [createWeaponState(weaponById(template.starterId)?.id ?? WEAPONS[0].id)],
    stats: { ...template.stats },
    stacks: new Map(),
    offered: [],
    moveTarget: null,
  };
}
