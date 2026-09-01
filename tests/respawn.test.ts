import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { damagePlayer } from '../src/systems/damage';
import { movementSystem } from '../src/systems/movement';
import { progressionSystem, xpForNextLevel } from '../src/systems/progression';
import { RESPAWN_OFFSET, respawnDelay, respawnSystem } from '../src/systems/respawn';
import { isAlive, nextLiving, viewedBy } from '../src/world/party';
import { World } from '../src/world/world';
import type { Player } from '../src/world/types';

/**
 * Dying with somebody left standing.
 *
 * A run ends when the last player falls; anybody else going down starts a wait.
 * What the wait is made of — a countdown, a camera over a teammate's shoulder,
 * and a body that comes back beside whoever that was — is what these check.
 */

const DT = 1 / 60;

function party(seed: number, count: number): World {
  return new World(seed, Array.from({ length: count }, () => 'bolt'));
}

function place(world: World, index: number, x: number, y: number): Player {
  const player = world.players[index];
  player.x = x;
  player.y = y;
  player.px = x;
  player.py = y;
  return player;
}

function kill(world: World, index: number): Player {
  const player = world.players[index];
  damagePlayer(world, player, player.stats.maxHp * 2);
  return player;
}

describe('how long the wait is', () => {
  it('is a minute per teammate', () => {
    expect(respawnDelay(party(1, 2))).toBe(60);
    expect(respawnDelay(party(1, 3))).toBe(120);
    expect(respawnDelay(party(1, 4))).toBe(180);
  });

  /**
   * Read off the roster and not off who is still up. Otherwise a second death
   * would shorten the first player's wait, which reads as the game rewarding a
   * party for falling apart.
   */
  it('does not shorten when somebody else falls too', () => {
    const world = party(2, 4);
    kill(world, 0);
    const due = world.players[0].respawnAt;

    kill(world, 1);

    expect(world.players[0].respawnAt).toBe(due);
  });

  it('is nothing for a solo run, which never reaches it', () => {
    const world = party(3, 1);
    kill(world, 0);

    expect(world.phase).toBe('dead');
    expect(respawnDelay(world)).toBe(0);
  });
});

describe('going down', () => {
  it('starts a countdown instead of ending the run', () => {
    const world = party(4, 2);
    world.time = 30;

    const fallen = kill(world, 0);

    expect(world.phase).toBe('playing');
    expect(fallen.hp).toBe(0);
    expect(fallen.respawnAt).toBe(30 + respawnDelay(world));
  });

  it('still ends the run when the last one falls', () => {
    const world = party(5, 2);
    kill(world, 0);
    kill(world, 1);

    expect(world.phase).toBe('dead');
  });

  it('puts the camera on the nearest teammate', () => {
    const world = party(6, 3);
    place(world, 0, 0, 0);
    place(world, 1, 900, 0);
    place(world, 2, 120, 0);

    const fallen = kill(world, 0);

    expect(fallen.watching).toBe(2);
    expect(viewedBy(world, fallen)).toBe(world.players[2]);
  });

  it('leaves the living looking through their own eyes', () => {
    const world = party(7, 2);
    const standing = world.players[1];

    expect(viewedBy(world, standing)).toBe(standing);
  });

  /**
   * The corpse used to slide around under whatever the keyboard was still
   * saying, which is what this project found when somebody asked what death
   * looks like.
   */
  it('does not walk', () => {
    const world = party(8, 2);
    const fallen = kill(world, 0);
    fallen.intentX = 1;
    fallen.moveTarget = { x: 1000, y: 0 };
    const where = fallen.x;

    for (let tick = 0; tick < 60; tick++) movementSystem(world, DT);

    expect(fallen.x).toBe(where);
  });

  /**
   * A downed player is coming back, and one who spent the wait choosing what to
   * come back as is still in the run.
   */
  it('still earns the levels the party is earning', () => {
    const world = party(9, 2);
    const fallen = kill(world, 0);

    world.xp = xpForNextLevel(world);
    progressionSystem(world);

    expect(fallen.pendingLevels).toBe(1);
  });
});

describe('the camera a dead player has', () => {
  it('walks along the living and wraps round', () => {
    const world = party(10, 4);
    kill(world, 3);

    expect(nextLiving(world, 0)).toBe(1);
    expect(nextLiving(world, 1)).toBe(2);
    // Skips the fallen fourth and comes back to the first.
    expect(nextLiving(world, 2)).toBe(0);
  });

  it('leaves a corpse to follow somebody who is still standing', () => {
    const world = party(11, 3);
    place(world, 0, 0, 0);
    place(world, 1, 100, 0);
    place(world, 2, 800, 0);

    const fallen = kill(world, 0);
    expect(fallen.watching).toBe(1);

    kill(world, 1);
    respawnSystem(world);

    expect(fallen.watching).toBe(2);
    expect(viewedBy(world, fallen)).toBe(world.players[2]);
  });

  it('answers with itself when there is nobody left to watch', () => {
    const world = party(12, 2);
    const fallen = kill(world, 0);
    world.players[1].hp = 0;

    expect(viewedBy(world, fallen)).toBe(fallen);
  });
});

describe('coming back', () => {
  it('waits out the countdown and not a tick less', () => {
    const world = party(13, 2);
    place(world, 1, 500, 0);
    const fallen = kill(world, 0);

    world.time = fallen.respawnAt - 0.001;
    respawnSystem(world);
    expect(isAlive(fallen)).toBe(false);

    world.time = fallen.respawnAt;
    respawnSystem(world);
    expect(isAlive(fallen)).toBe(true);
  });

  /**
   * Beside the player they were watching, which is what makes choosing who to
   * watch a decision rather than a preference.
   */
  it('appears beside whoever was being watched', () => {
    const world = party(14, 3);
    place(world, 0, 0, 0);
    place(world, 1, 400, 0);
    place(world, 2, -900, 0);

    const fallen = kill(world, 0);
    fallen.watching = 2;

    world.time = fallen.respawnAt;
    respawnSystem(world);

    const host = world.players[2];
    expect(Math.hypot(fallen.x - host.x, fallen.y - host.y)).toBeCloseTo(RESPAWN_OFFSET);
    expect(fallen.px).toBe(fallen.x);
    expect(fallen.py).toBe(fallen.y);
  });

  it('comes back whole, with a moment to read the screen', () => {
    const world = party(15, 2);
    place(world, 1, 300, 0);
    const fallen = kill(world, 0);

    world.time = fallen.respawnAt;
    respawnSystem(world);

    expect(fallen.hp).toBe(fallen.stats.maxHp);
    expect(fallen.respawnAt).toBe(0);
    expect(fallen.invuln).toBe(CONFIG.player.respawnGrace);
  });

  it('drops whatever was held down when they died', () => {
    const world = party(16, 2);
    place(world, 1, 300, 0);
    const fallen = kill(world, 0);
    fallen.intentX = 1;
    fallen.intentY = -1;
    fallen.moveTarget = { x: 9000, y: 0 };

    world.time = fallen.respawnAt;
    respawnSystem(world);

    expect(fallen.intentX).toBe(0);
    expect(fallen.intentY).toBe(0);
    expect(fallen.moveTarget).toBeNull();
  });

  it('does not come back into a wiped party', () => {
    const world = party(17, 2);
    const fallen = kill(world, 0);
    const due = fallen.respawnAt;
    kill(world, 1);

    world.time = due + 10;
    respawnSystem(world);

    expect(isAlive(fallen)).toBe(false);
    expect(world.phase).toBe('dead');
  });
});
