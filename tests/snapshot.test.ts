import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { SPRITE_NAMES, spriteIndex } from '../src/data/sprites';
import { SPRITE_SPECS } from '../src/render/atlas';
import { VIEW_RADIUS, applySnapshot, encodeSnapshot } from '../src/net/snapshot';
import { applyUpgrade } from '../src/systems/progression';
import { BOSS, ENEMIES } from '../src/data/enemies';
import { rollEnemyDef, spawnEnemy, spawnEnemyAt } from '../src/systems/spawn';
import { stepWorld } from '../src/world/step';
import { World } from '../src/world/world';
import { runBot } from './bot';

/**
 * The world on a wire.
 *
 * A guest never steps a simulation; it draws what the host sends. So the thing
 * these check is not "does it round-trip" in the abstract but "would the screen
 * be right": every number the renderer and the HUD read has to survive the
 * journey, and everything else is allowed to be dropped on purpose.
 */

const DT = 1 / CONFIG.tickRate;

/**
 * The most a position can move by being sent.
 *
 * Positions travel as `int16` at quarter-unit precision, so rounding to the
 * nearest step costs half of one. Asserted as the format's own guarantee rather
 * than as a number of decimal places — the smallest thing on screen is seven
 * units across, so an eighth of one is a tenth of a pixel nobody can see.
 */
const QUANTUM = 0.125;

function expectPlaced(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
    QUANTUM,
  );
}

/** A world several minutes in, with a full field and a fought-over build. */
function midRun(seed: number, seconds: number): World {
  return runBot(seed, seconds);
}

/** The same world, received. */
function received(host: World): World {
  const guest = new World(host.seed);
  applySnapshot(guest, encodeSnapshot(host));
  return guest;
}

describe('the numbered sprite vocabulary', () => {
  /**
   * A sprite travels as one byte, so the list and the union have to be the same
   * set. The compiler already refuses a name that is not in the union; this is
   * the other direction — a frame added to the game and forgotten here would
   * encode as -1 and arrive as something else entirely.
   */
  it('numbers every frame the atlas packs', () => {
    for (const spec of SPRITE_SPECS) {
      expect(SPRITE_NAMES, spec.name).toContain(spec.name);
      expect(spriteIndex(spec.name), spec.name).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(SPRITE_NAMES).size).toBe(SPRITE_NAMES.length);
  });
});

describe('what survives the journey', () => {
  it('carries the run itself', () => {
    const host = midRun(42, 240);
    const guest = received(host);

    expect(guest.time).toBeCloseTo(host.time);
    expect(guest.kills).toBe(host.kills);
    expect(guest.level).toBe(host.level);
    expect(guest.xp).toBe(host.xp);
    expect(guest.phase).toBe(host.phase);
    expect(guest.bossesKilled).toBe(host.bossesKilled);
    expect(guest.nextBossAt).toBeCloseTo(host.nextBossAt);
  });

  it('carries every player, where they are and what they are holding', () => {
    const host = new World(7, ['bolt', 'nova', 'ember', 'orbit']);
    for (let i = 0; i < host.players.length; i++) {
      host.players[i].x = i * 130;
      host.players[i].y = -i * 40;
      host.players[i].hp = 80 - i * 10;
    }
    applyUpgrade(host, host.players[1], 'orbit');
    for (let tick = 0; tick < 120; tick++) stepWorld(host, DT);

    const guest = received(host);
    expect(guest.players).toHaveLength(4);

    for (let i = 0; i < 4; i++) {
      const there = host.players[i];
      const here = guest.players[i];

      expectPlaced(here.x, there.x, `player ${i} x`);
      expectPlaced(here.y, there.y, `player ${i} y`);
      expect(here.hp).toBe(Math.round(there.hp));
      expect(here.sprite).toBe(there.sprite);
      expect(here.stats.maxHp).toBe(there.stats.maxHp);
      expect(here.weapons.map((w) => w.defId)).toEqual(there.weapons.map((w) => w.defId));
      expect(here.weapons.map((w) => w.level)).toEqual(there.weapons.map((w) => w.level));
    }
  });

  /**
   * The ring and the lance have no entity behind them: they are redrawn from
   * the weapon's own numbers. If those do not travel, a guest sees a player
   * with no blades around them.
   */
  it('carries what a weapon needs to be drawn', () => {
    const host = new World(8, ['orbit']);
    for (let tick = 0; tick < 90; tick++) stepWorld(host, DT);

    const there = host.players[0].weapons[0];
    const here = received(host).players[0].weapons[0];

    expect(here.angle).toBeCloseTo(there.angle, 3);
    expect(here.pangle).toBeCloseTo(there.pangle, 3);
    expect(here.areaMul).toBeCloseTo(there.areaMul, 2);
    expect(here.spinMul).toBeCloseTo(there.spinMul, 2);
  });

  it('carries the horde as definitions rather than as properties', () => {
    const host = midRun(1337, 200);
    const guest = received(host);

    expect(guest.enemies.length).toBeGreaterThan(0);
    for (let i = 0; i < guest.enemies.length; i++) {
      const there = host.enemies[i];
      const here = guest.enemies[i];

      expect(here.defId).toBe(there.defId);
      // Radius, colour and frame are the definition's, looked up rather than
      // sent — the whole reason a body costs six bytes.
      expect(here.sprite).toBe(there.sprite);
      expect(here.radius).toBe(there.radius);
      expect(here.color).toBe(there.color);
      expectPlaced(here.x, there.x, `enemy ${i} x`);
      expectPlaced(here.y, there.y, `enemy ${i} y`);
    }
  });

  it('carries the shots, the gems, the fire and the rings', () => {
    const host = midRun(99, 260);
    const guest = received(host);

    expect(guest.projectiles).toHaveLength(host.projectiles.length);
    for (let i = 0; i < guest.projectiles.length; i++) {
      expect(guest.projectiles[i].sprite).toBe(host.projectiles[i].sprite);
      expect(guest.projectiles[i].color).toBe(host.projectiles[i].color);
      expectPlaced(guest.projectiles[i].x, host.projectiles[i].x, `shot ${i}`);
    }

    expect(guest.flames).toHaveLength(host.flames.length);
    for (let i = 0; i < guest.flames.length; i++) {
      expectPlaced(guest.flames[i].radius, host.flames[i].radius, `flame ${i}`);
      expect(guest.flames[i].life).toBeCloseTo(host.flames[i].life, 2);
    }
  });

  it('carries the boss bar as the fraction the bar draws', () => {
    const host = new World(11);
    host.time = CONFIG.boss.interval;
    stepWorld(host, DT);

    const boss = host.enemies.find((enemy) => enemy.boss);
    expect(boss).toBeDefined();
    if (boss === undefined) return;
    boss.hp = boss.maxHp / 2;

    const here = received(host).enemies.find((enemy) => enemy.boss);
    expect(here).toBeDefined();
    expect((here?.hp ?? 0) / (here?.maxHp ?? 1)).toBeCloseTo(0.5, 2);
  });

  it('carries the chest, and the absence of one', () => {
    const host = new World(12);
    host.chest = { x: 420.5, y: -300.25 };

    const withChest = received(host);
    expectPlaced(withChest.chest?.x ?? 0, 420.5, 'chest x');
    expectPlaced(withChest.chest?.y ?? 0, -300.25, 'chest y');

    host.chest = null;
    expect(received(host).chest).toBeNull();
  });
});

describe('what is deliberately left out', () => {
  /**
   * Gems are never removed except by being collected, so a long run leaves them
   * scattered over every metre it covered. Sending all of them would grow a
   * snapshot all run and spend most of it on treasure nobody can see.
   */
  it('drops what is too far from everybody to be on a screen', () => {
    const host = new World(13);
    const near = host.gemPool.obtain();
    near.x = 100;
    near.y = 0;
    near.value = 1;
    host.gems.push(near);

    const far = host.gemPool.obtain();
    far.x = VIEW_RADIUS + 500;
    far.y = 0;
    far.value = 1;
    host.gems.push(far);

    const guest = received(host);
    expect(guest.gems).toHaveLength(1);
    expectPlaced(guest.gems[0].x, 100, 'gem');
  });

  it('keeps what is far from one player but close to another', () => {
    const host = new World(14, ['bolt', 'bolt']);
    host.players[1].x = 4000;

    const gem = host.gemPool.obtain();
    gem.x = 4050;
    gem.y = 0;
    gem.value = 1;
    host.gems.push(gem);

    expect(received(host).gems).toHaveLength(1);
  });
});

/**
 * A snapshot cut for one machine rather than for the party.
 *
 * Cut around the party, every guest is sent every other guest's screen — three
 * quarters of it ground they cannot see. Cut around what they are looking at, it
 * is one screen's worth however far apart everybody has wandered.
 */
describe('a snapshot cut for one pair of eyes', () => {
  function twoCrowds(): World {
    const host = new World(21, ['bolt', 'bolt']);
    host.players[0].x = 0;
    host.players[1].x = 6000;

    for (let i = 0; i < 40; i++) {
      spawnEnemyAt(host, ENEMIES[0], 1, i * 5, 0);
      spawnEnemyAt(host, ENEMIES[0], 1, 6000 + i * 5, 0);
    }
    return host;
  }

  it('carries only what that end can see', () => {
    const host = twoCrowds();

    const near = new World(host.seed);
    applySnapshot(near, encodeSnapshot(host, { x: 6000, y: 0 }));

    expect(near.enemies).toHaveLength(40);
    for (const enemy of near.enemies) {
      expect(enemy.x).toBeGreaterThan(5000);
    }
  });

  it('carries both crowds when nobody in particular is looking', () => {
    const host = twoCrowds();
    expect(received(host).enemies).toHaveLength(80);
  });

  /**
   * Every player travels whatever the focus is. The roster, the health bars and
   * the spectator camera all need everybody, and four people are a couple of
   * hundred bytes — what is worth culling is the six hundred bodies.
   */
  it('carries every player even from the other side of the map', () => {
    const host = twoCrowds();

    const near = new World(host.seed);
    applySnapshot(near, encodeSnapshot(host, { x: 6000, y: 0 }));

    expect(near.players).toHaveLength(2);
    expectPlaced(near.players[0].x, 0, 'the distant player');
  });

  it('is smaller than the one cut for everybody', () => {
    const host = twoCrowds();

    const forOne = encodeSnapshot(host, { x: 6000, y: 0 }).byteLength;
    const forAll = encodeSnapshot(host).byteLength;

    expect(forOne).toBeLessThan(forAll);
  });
});

describe('a snapshot as a stream of them', () => {
  /**
   * A snapshot is the whole picture rather than a patch, which is what makes
   * joining a run in progress need no special case: the next one to arrive is
   * as good as the first.
   */
  it('lands the same picture whether or not the last one did', () => {
    const host = midRun(2024, 200);

    const fresh = received(host);
    const reused = new World(host.seed);
    applySnapshot(reused, encodeSnapshot(midRun(5, 120)));
    applySnapshot(reused, encodeSnapshot(host));

    expect(reused.enemies.length).toBe(fresh.enemies.length);
    expect(reused.kills).toBe(fresh.kills);
    expect(reused.gems.length).toBe(fresh.gems.length);
  });

  /**
   * The previous position carries into `px`/`py`, so the renderer's own
   * interpolation smooths the gap between snapshots. That is the whole of a
   * guest's smoothing, and it is why twenty a second look like sixty.
   */
  it('leaves the last position behind to interpolate from', () => {
    const host = new World(15);
    const guest = new World(15);

    host.players[0].x = 100;
    applySnapshot(guest, encodeSnapshot(host));
    host.players[0].x = 160;
    applySnapshot(guest, encodeSnapshot(host));

    expectPlaced(guest.players[0].px, 100, 'previous');
    expectPlaced(guest.players[0].x, 160, 'current');
  });

  /** A guest allocates no more per frame than the host does. */
  it('recycles through the pools rather than building entities', () => {
    const host = midRun(808, 200);
    const guest = new World(host.seed);

    applySnapshot(guest, encodeSnapshot(host));
    const afterFirst = guest.enemyPool.allocated;

    for (let i = 0; i < 20; i++) applySnapshot(guest, encodeSnapshot(host));

    expect(guest.enemyPool.allocated).toBe(afterFirst);
  });
});

/**
 * What it costs, measured rather than assumed.
 *
 * The number that matters is not one snapshot but a second of them for a full
 * party: the host uploads its own view to everybody else, so the bill is
 * `bytes × rate × guests`, and a home connection has about a megabit of
 * upstream to spend.
 */
describe('what a snapshot costs', () => {
  it('fits a full field into a few kilobytes', () => {
    const host = new World(4242, ['bolt', 'nova', 'spear', 'ember']);
    host.time = 300;
    for (const id of ['orbit', 'nova', 'damage', 'haste']) {
      applyUpgrade(host, host.players[0], id);
    }
    // The ceiling the game caps itself to, so this is the worst honest case.
    while (host.enemies.length < CONFIG.spawn.maxEnemies) {
      spawnEnemy(host, rollEnemyDef(host), 4);
    }
    for (let tick = 0; tick < 60; tick++) stepWorld(host, DT);

    const eyes = host.players[0];
    const bytes = encodeSnapshot(host, { x: eyes.x, y: eyes.y }).byteLength;
    const perSecond = (bytes * 20) / 1024;

    console.log(
      `\nsnapshot: ${bytes} bytes at ${host.enemies.length} enemies, ` +
        `${host.gems.length} gems, ${host.flames.length} flames\n` +
        `  ${perSecond.toFixed(0)} KiB/s per guest at 20 Hz, ` +
        `${((perSecond * 8 * 3) / 1024).toFixed(2)} Mbit/s up for a full party\n`,
    );

    // A guard rail rather than a target: JSON of the same field is about ten
    // times this, and the point of the format is that it is not.
    expect(bytes).toBeLessThan(8 * 1024);
  });

  it('costs almost nothing on an empty field', () => {
    expect(encodeSnapshot(new World(1)).byteLength).toBeLessThan(128);
  });
});

/**
 * The one thing about a boss that is worked out rather than sent.
 *
 * The boss bar is titled after the ability, and the ability is a function of the
 * seed and the count of the fallen — both of which a guest already has. So it
 * costs nothing on the wire and must not be skipped: an enemy comes out of a
 * pool, and a field left unwritten carries whatever the last occupant of that
 * slot had.
 */
describe('naming the fight on a guest', () => {
  function duel(seed: number, killed: number): { host: World; guest: World } {
    const host = new World(seed);
    host.bossesKilled = killed;
    spawnEnemyAt(host, BOSS, 1, 300, 0);
    return { host, guest: received(host) };
  }

  it('calls the boss what the host calls it', () => {
    for (const killed of [0, 1, 4, 9, 17]) {
      const { host, guest } = duel(2024, killed);

      expect(guest.enemies).toHaveLength(1);
      expect(guest.enemies[0].ability, `duel ${killed}`).toBe(host.enemies[0].ability);
      expect(guest.enemies[0].ability).not.toBe('');
    }
  });

  /**
   * And does not leave a stale one on a body that is not a boss. This is the
   * pool hazard written as a test: a slot that held a boss is reused for a
   * grunt, and a grunt with an ability would be a grunt that wards.
   */
  it('leaves nothing behind on the grunt that reuses the slot', () => {
    const { guest } = duel(2024, 3);
    expect(guest.enemies[0].ability).not.toBe('');

    const host = new World(2024);
    spawnEnemyAt(host, ENEMIES[0], 1, 300, 0);
    applySnapshot(guest, encodeSnapshot(host));

    expect(guest.enemies).toHaveLength(1);
    expect(guest.enemies[0].boss).toBe(false);
    expect(guest.enemies[0].ability).toBe('');
  });
});
