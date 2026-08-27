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
  if (!world.bossSpawned && world.time >= CONFIG.runDuration) {
    world.bossSpawned = true;
    spawnEnemy(world, BOSS, 1);
    return;
  }

  // Once the boss is out, the run is a duel — stop feeding the horde.
  if (world.bossSpawned) return;

  // A breather first. Without it the duel is fought through six hundred grunts,
  // and the boss is just a slightly larger dot in a wall of them.
  if (world.time >= CONFIG.runDuration - CONFIG.spawn.bossLull) return;

  const minutes = world.time / 60;
  const rate = (1 + minutes * CONFIG.spawn.pressurePerMinute) * waveIntensity(world.time);
  const interval = Math.max(0.05, CONFIG.spawn.baseInterval / rate);
  const batchSize = 1 + Math.floor(minutes * CONFIG.spawn.batchPerMinute);
  const hpScale = 1 + minutes * CONFIG.spawn.hpScalePerMinute;

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

  const enemy = world.enemyPool.obtain();
  enemy.id = world.nextEntityId++;
  enemy.x = world.player.x + Math.cos(angle) * distance;
  enemy.y = world.player.y + Math.sin(angle) * distance;
  enemy.px = enemy.x;
  enemy.py = enemy.y;
  enemy.hp = def.hp * hpScale;
  enemy.maxHp = enemy.hp;
  enemy.speed = def.speed;
  enemy.damage = def.damage;
  enemy.radius = def.radius;
  enemy.xpValue = def.xp;
  enemy.color = def.color;
  enemy.flash = 0;
  enemy.hitTag = 0;
  enemy.boss = def.id === BOSS.id;

  world.enemies.push(enemy);
}
