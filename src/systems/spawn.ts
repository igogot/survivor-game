import { CONFIG } from '../config';
import { TAU } from '../core/math';
import { BOSS, ENEMIES } from '../data/enemies';
import type { EnemyDef } from '../data/enemies';
import type { World } from '../world/world';

/**
 * Difficulty is a function of elapsed time only: spawns get more frequent, come
 * in bigger batches, and every enemy gets a flat HP multiplier. Each curve is a
 * single line to retune, and all three are measured by the bot in tests/bot.ts
 * rather than guessed at.
 */
export function spawnSystem(world: World, dt: number): void {
  if (!world.bossSpawned && world.time >= world.nextBossAt) {
    world.bossSpawned = true;
    world.hordeResumesAt = world.time + CONFIG.boss.duelGrace;
    spawnEnemy(world, BOSS, bossHpScale(world));
    return;
  }

  if (world.bossSpawned) {
    // The duel is quiet, but not for as long as the player likes. A boss they
    // cannot finish has to be fought through the horde — see CONFIG.boss.
    if (world.time < world.hordeResumesAt) return;
  } else if (world.time >= world.nextBossAt - CONFIG.boss.lull) {
    // A breather first. Without it the duel is fought through six hundred
    // grunts, and the boss is just a slightly larger dot in a wall of them.
    return;
  }

  const interval = spawnInterval(world);
  const batchSize = spawnBatch(world);
  const hpScale = hordeHpScale(world);

  world.spawnTimer -= dt;
  while (world.spawnTimer <= 0) {
    if (world.enemies.length >= CONFIG.spawn.maxEnemies) {
      // Reset rather than let the debt accumulate, otherwise clearing the
      // screen later would dump the entire backlog at once.
      world.spawnTimer = interval;
      break;
    }
    world.spawnTimer += interval;
    for (let i = 0; i < batchSize; i++) {
      spawnEnemy(world, rollEnemyDef(world), hpScale);
    }
  }
}

/** Seconds between spawn ticks right now, surges included. */
export function spawnInterval(world: World): number {
  const minutes = world.time / 60;
  const rate = (1 + minutes * CONFIG.spawn.pressurePerMinute) * waveIntensity(world.time);
  return Math.max(0.05, CONFIG.spawn.baseInterval / rate);
}

/** Enemies delivered per spawn tick right now. */
export function spawnBatch(world: World): number {
  return 1 + Math.floor((world.time / 60) * CONFIG.spawn.batchPerMinute);
}

/**
 * What one enemy costs the spawner in seconds, at the current difficulty.
 *
 * Anything that puts a body on the field outside the spawner charges itself
 * this, so the horde's budget stays the horde's budget. Without it a splitter
 * is a hole in the difficulty curve: every one killed leaves a net extra
 * enemy, so a player who kills well is punished for it, and the stand measured
 * exactly that — a fifth off the average run, insensitive to the splitter's
 * own weight, speed and HP because none of those was the mechanism.
 */
export function bodyCost(world: World): number {
  return spawnInterval(world) / spawnBatch(world);
}

/**
 * The HP multiplier every ordinary enemy spawned right now carries.
 *
 * A pure function of elapsed time, so anything that puts an enemy into the
 * world outside the spawner — a splitter coming apart, a test — gets exactly
 * what the spawner would have given it, without having to remember the formula.
 */
export function hordeHpScale(world: World): number {
  return 1 + (world.time / 60) * CONFIG.spawn.hpScalePerMinute;
}

/**
 * How much HP the boss due now carries over the first one.
 *
 * Counts bosses rather than minutes on purpose — see `CONFIG.boss`. Exported so
 * a test can assert the second duel is harder than the first without knowing
 * the arithmetic.
 */
export function bossHpScale(world: World): number {
  return 1 + world.bossesKilled * CONFIG.boss.hpScalePerBoss;
}

/**
 * A boss dying is a checkpoint, not an ending.
 *
 * The horde resumes — the difficulty curve never stopped climbing while the
 * duel was on, so what comes back is worse than what left — and the clock for
 * the next arrival starts from this moment rather than from a fixed grid, so
 * the breather is the same length whether the duel took twenty seconds or two
 * minutes.
 */
export function defeatBoss(world: World): void {
  world.bossesKilled++;
  world.bossSpawned = false;
  world.nextBossAt = world.time + CONFIG.boss.interval;
}

/**
 * Surges and lulls, as a multiplier on the spawn rate.
 *
 * A monotonic ramp has no rhythm — the player is either coping or not, and
 * never gets the beat of "hold on, now breathe". One smooth pulse per cycle
 * gives back the window where levelling up and collecting gems is worth doing.
 * Smooth rather than a step, because a rate that doubles between two ticks
 * reads as a bug.
 */
export function waveIntensity(time: number): number {
  const phase = time % CONFIG.spawn.wavePeriod;
  if (phase >= CONFIG.spawn.waveSurge) return 1;

  return 1 + (CONFIG.spawn.wavePeak - 1) * Math.sin((Math.PI * phase) / CONFIG.spawn.waveSurge);
}

/**
 * Weighted pick among the types unlocked at the current run time.
 *
 * Exported alongside `spawnEnemy` so a harness can populate a world the way the
 * game does — see tests/perf.bench.ts, which holds a fixed enemy count.
 */
export function rollEnemyDef(world: World): EnemyDef {
  let totalWeight = 0;
  for (let i = 0; i < ENEMIES.length; i++) {
    if (ENEMIES[i].unlockAt <= world.time) totalWeight += ENEMIES[i].weight;
  }

  let roll = world.rng.next() * totalWeight;
  for (let i = 0; i < ENEMIES.length; i++) {
    const def = ENEMIES[i];
    if (def.unlockAt > world.time) continue;
    roll -= def.weight;
    if (roll <= 0) return def;
  }

  return ENEMIES[0];
}

/**
 * Where on the ring an enemy appears.
 *
 * Most of them are placed in front of the player. A uniformly random ring makes
 * running in one direction a dominant strategy: the player outruns the horde,
 * everything behind them despawns, and the screen empties out. Spawning into
 * the path means running buys distance from *this* crowd, not from the game.
 */
function spawnAngle(world: World): number {
  const heading = Math.hypot(world.headingX, world.headingY);

  // Standing still has no "ahead".
  if (heading < 0.15 || world.rng.next() >= CONFIG.spawn.aheadBias) {
    return world.rng.next() * TAU;
  }

  const forward = Math.atan2(world.headingY, world.headingX);
  return forward + world.rng.range(-CONFIG.spawn.aheadSpread, CONFIG.spawn.aheadSpread);
}

export function spawnEnemy(world: World, def: EnemyDef, hpScale: number): void {
  // Spawning on a ring guarantees enemies appear off-screen regardless of
  // viewport size, so the player never sees one pop into existence.
  const angle = spawnAngle(world);
  const distance = CONFIG.spawn.ringRadius;

  spawnEnemyAt(
    world,
    def,
    hpScale,
    world.player.x + Math.cos(angle) * distance,
    world.player.y + Math.sin(angle) * distance,
  );
}

/**
 * Puts one enemy at an exact position.
 *
 * Split out from `spawnEnemy` because the ring is the only thing that makes a
 * spawn a spawn: a splitter's children have to appear where it died, in plain
 * sight, and everything else about them is identical.
 *
 * Every field is written unconditionally. The enemy comes from a pool, so a
 * field left alone is not a default — it is whatever the last occupant left.
 */
export function spawnEnemyAt(
  world: World,
  def: EnemyDef,
  hpScale: number,
  x: number,
  y: number,
): void {
  const enemy = world.enemyPool.obtain();
  enemy.id = world.nextEntityId++;
  enemy.defId = def.id;
  enemy.x = x;
  enemy.y = y;
  enemy.px = enemy.x;
  enemy.py = enemy.y;
  enemy.hp = def.hp * hpScale;
  enemy.maxHp = enemy.hp;
  enemy.speed = def.speed;
  enemy.damage = def.damage;
  enemy.radius = def.radius;
  enemy.xpValue = def.xp;
  enemy.color = def.color;
  enemy.sprite = def.sprite;
  enemy.flash = 0;
  enemy.hitTag = 0;
  enemy.boss = def.id === BOSS.id;

  world.enemies.push(enemy);
}
