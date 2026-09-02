import { CONFIG } from '../config';
import { TAU } from '../core/math';
import { BOSS, ENEMIES } from '../data/enemies';
import { bossAbility, rotationStart } from '../data/bossAbilities';
import { arrivalScale, healthScale, partyAnchor, partySize } from '../world/party';
import type { BossAbilityDef } from '../data/bossAbilities';
import type { EnemyDef } from '../data/enemies';
import type { PartyAnchor } from '../world/party';
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
    if (world.enemies.length >= enemyCeiling(world)) {
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
 * Seconds between spawn ticks right now, surges included.
 *
 * A party shortens it: the horde has to arrive faster to put a solo-sized crowd
 * around each of several people. What it does *not* do is arrive faster and
 * hit harder — see `CONFIG.spawn.perPlayerArrivals`.
 */
export function spawnInterval(world: World): number {
  const minutes = world.time / 60;
  const rate =
    (1 + minutes * CONFIG.spawn.pressurePerMinute) *
    waveIntensity(world.time) *
    arrivalScale(world);
  return Math.max(0.05, CONFIG.spawn.baseInterval / rate);
}

/**
 * The ceiling on bodies alive at once, for the party actually playing.
 *
 * It follows the *arrival* scale rather than the party's size, and the
 * difference matters at both ends of the slider. Where the multiplier is spent
 * on arrivals, the ceiling has to move with them or the cap becomes the
 * difficulty: a four at four times the arrivals would sit against a solo
 * player's ceiling all run, and the thing deciding how hard the game is would
 * be a constant chosen to protect the frame rate. Where it is spent on health
 * instead, the horde arrives at a solo player's rate and is killed at a solo
 * player's rate, so a party that raised its own ceiling would only be buying
 * itself headroom in the surges where the cap actually binds — which is relief
 * a solo player never gets.
 */
export function enemyCeiling(world: World): number {
  return CONFIG.spawn.maxEnemies * arrivalScale(world);
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
 * A pure function of elapsed time and party size, so anything that puts an
 * enemy into the world outside the spawner — a splitter coming apart, a test —
 * gets exactly what the spawner would have given it, without having to remember
 * the formula.
 *
 * Party size multiplies it flat: two players meet enemies with twice the
 * health, three meet three times. Two players are roughly twice the damage, so
 * this is what keeps a body worth about the same number of seconds however many
 * people are shooting at it — without it a party deletes the horde on contact
 * and the whole difficulty curve happens to somebody else.
 *
 * Baked in at spawn rather than recomputed, so a body keeps the health it was
 * born with. A party that loses somebody faces a lighter horde from that moment
 * on and not retroactively, which is both the cheaper thing to implement and
 * the more defensible one: the bodies already on the field were made by a
 * bigger party.
 */
export function hordeHpScale(world: World): number {
  return (1 + (world.time / 60) * CONFIG.spawn.hpScalePerMinute) * healthScale(world);
}

/**
 * How much HP the boss due now carries over the first one.
 *
 * Counts bosses rather than minutes on purpose — see `CONFIG.boss` — and then
 * takes the party's full size, not the horde's split of it.
 *
 * The split exists because a horde is a flow: arrivals and toughness trade off
 * against each other while the party kills it as fast as it comes. A boss is
 * not a flow, it is one body, and there is no "arrive faster" to spend the
 * multiplier on. Four people are four times the damage pointed at it, so its
 * bar takes four times the health or the one fight the game asks a party to
 * actually win melts in a quarter of the time.
 *
 * Exported so a test can assert the second duel is harder than the first
 * without knowing the arithmetic.
 */
export function bossHpScale(world: World): number {
  return (1 + world.bossesKilled * CONFIG.boss.hpScalePerBoss) * partySize(world);
}

/**
 * Which fight the boss arriving now is.
 *
 * `bossesKilled` is the duel's number: only one boss lives at a time and the
 * next is not scheduled until this one is down, so the count of the fallen is
 * the number of the one arriving. What that number indexes is offset by where
 * this run's rotation starts — see `rotationStart`, which exists because with
 * every run starting at the top, nine of the ten fights were unreachable.
 *
 * One function for the two things a boss needs on arrival, its ability and its
 * first cooldown, so they cannot answer differently.
 */
export function arrivingAbility(world: World): BossAbilityDef {
  return bossAbility(world.bossesKilled + rotationStart(world.seed));
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
 * Where on the ring an enemy appears, relative to the party's own heading.
 *
 * Most of them are placed in front. A uniformly random ring makes running in
 * one direction a dominant strategy: the players outrun the horde, everything
 * behind them despawns, and the screen empties out. Spawning into the path
 * means running buys distance from *this* crowd, not from the game.
 */
function spawnAngle(world: World, anchor: PartyAnchor): number {
  const heading = Math.hypot(anchor.headingX, anchor.headingY);

  // Standing still has no "ahead". So has a party pulling in four directions,
  // whose average heading is nothing much — which is the honest answer rather
  // than an accident: a group that is not going anywhere together gets a ring.
  if (heading < 0.15 || world.rng.next() >= CONFIG.spawn.aheadBias) {
    return world.rng.next() * TAU;
  }

  const forward = Math.atan2(anchor.headingY, anchor.headingX);
  return forward + world.rng.range(-CONFIG.spawn.aheadSpread, CONFIG.spawn.aheadSpread);
}

export function spawnEnemy(world: World, def: EnemyDef, hpScale: number): void {
  // Spawning on a ring guarantees enemies appear off-screen regardless of
  // viewport size, so nobody ever sees one pop into existence. The ring is hung
  // on the party rather than on a person — see `partyAnchor` for why that is a
  // decision and not a detail.
  const anchor = partyAnchor(world);
  const angle = spawnAngle(world, anchor);
  const distance = CONFIG.spawn.ringRadius;

  spawnEnemyAt(
    world,
    def,
    hpScale,
    anchor.x + Math.cos(angle) * distance,
    anchor.y + Math.sin(angle) * distance,
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
  enemy.ability = enemy.boss ? arrivingAbility(world).id : '';
  enemy.abilityTimer = 0;
  enemy.standoff = def.ranged?.range ?? 0;
  // A boss waits one full cooldown before its first use: arriving and charging
  // on the same tick is a hit the player never saw coming, and the lull before
  // a duel exists precisely so they get to see it coming.
  //
  // Casters are staggered by a fraction of theirs instead, otherwise every one
  // that arrived in the same batch throws on the same tick for the rest of the
  // run. Everything else attacks by walking into somebody and never reads this.
  if (enemy.boss) {
    enemy.attackCooldown = arrivingAbility(world).cooldown;
  } else {
    enemy.attackCooldown = def.ranged === undefined ? 0 : world.rng.next() * def.ranged.cooldown;
  }

  world.enemies.push(enemy);
}
