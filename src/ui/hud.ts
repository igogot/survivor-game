import { CONFIG } from '../config';
import { weaponById } from '../data/weapons';
import type { Enemy, Player } from '../world/types';
import type { World } from '../world/world';

/**
 * The HUD is plain DOM rather than Pixi text.
 *
 * Text in WebGL means font atlases and blurry glyphs at odd resolutions, and
 * the HUD is static enough that the browser's own layout engine is both
 * sharper and less code. It sits in an overlay with `pointer-events: none` so
 * it never steals input from the canvas.
 */
/** HP per divider on the bar. Vitality adds segments instead of stretching them. */
const HP_PER_SEGMENT = 25;
/** Below this fraction the bar goes bright and starts pulsing. */
const LOW_HP = 0.3;
/** Time constant of the trailing chunk, in seconds. */
const GHOST_TAU = 0.35;

export class Hud {
  private readonly level = requireElement('level');
  private readonly hpWrap = requireElement('hp-wrap');
  private readonly hpFill = requireElement('hp-fill');
  private readonly hpGhost = requireElement('hp-ghost');
  private readonly hpTicks = requireElement('hp-ticks');
  private readonly hpText = requireElement('hp-text');
  private readonly xpFill = requireElement('xp-fill');
  private readonly timer = requireElement('timer');
  private readonly weapons = requireElement('stat-weapons');
  private readonly kills = requireElement('stat-kills');
  private readonly bosses = requireElement('stat-bosses');
  private readonly entities = requireElement('stat-entities');
  private readonly pool = requireElement('stat-pool');
  private readonly fps = requireElement('stat-fps');
  private readonly boss = requireElement('boss');
  private readonly bossFill = requireElement('boss-fill');
  private readonly warning = requireElement('warning');

  /** Exponential moving average — a raw per-frame value is unreadable. */
  private smoothedFps = 60;
  private lastFrameTime = 0;

  /** Where the trailing chunk of the HP bar currently sits, as a percentage. */
  private ghost = 100;
  private lastMaxHp = 0;

  update(world: World): void {
    const now = performance.now();
    const elapsed = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = now;
    if (elapsed > 0) this.smoothedFps += (1 / elapsed - this.smoothedFps) * 0.05;

    const player = world.player;

    this.level.textContent = `LV ${player.level}`;
    // Clamped: a tab returning from the background must not teleport the drain.
    this.updateHealth(player, Math.min(elapsed, 0.1));
    this.xpFill.style.width = `${percent(player.xp, player.xpToNext)}%`;

    // Unclamped: the run has no end for it to stop at.
    this.timer.textContent = formatTime(world.time);
    this.weapons.textContent = describeWeapons(world);
    this.kills.textContent = `kills ${world.kills}`;

    // Hidden until there is one, otherwise it is a zero the player carries for
    // the first ten minutes of every run.
    this.bosses.textContent = `bosses ${world.bossesKilled}`;
    this.bosses.hidden = world.bossesKilled === 0;
    this.entities.textContent = `enemies ${world.enemies.length}`;

    // Surfaced deliberately: `allocated` should plateau while the game keeps
    // spawning. If it climbs all run, the pool is leaking.
    this.pool.textContent = `pool ${world.enemyPool.allocated}`;
    this.fps.textContent = `${Math.round(this.smoothedFps)} fps`;

    this.updateBoss(world);
  }

  private updateHealth(player: Player, dt: number): void {
    const maxHp = player.stats.maxHp;
    const ratio = maxHp > 0 ? player.hp / maxHp : 0;
    const fill = percent(player.hp, maxHp);

    // Healing snaps forward, damage drains. The gap between the two bars is
    // exactly the damage taken in the last third of a second, which is what
    // makes a hit readable without looking away from the character.
    if (fill >= this.ghost) {
      this.ghost = fill;
    } else {
      this.ghost += (fill - this.ghost) * (1 - Math.exp(-dt / GHOST_TAU));
      if (this.ghost - fill < 0.25) this.ghost = fill;
    }

    this.hpFill.style.width = `${fill}%`;
    this.hpGhost.style.width = `${this.ghost}%`;
    this.hpText.textContent = `${Math.ceil(player.hp)} / ${Math.round(maxHp)}`;
    this.hpWrap.classList.toggle('low', ratio < LOW_HP);

    // Only when the maximum actually changes: writing a style every frame
    // forces a needless recalculation of the whole overlay.
    if (maxHp !== this.lastMaxHp) {
      this.lastMaxHp = maxHp;
      this.hpTicks.style.backgroundSize = `${(HP_PER_SEGMENT / maxHp) * 100}% 100%`;
    }
  }

  private updateBoss(world: World): void {
    const boss = findBoss(world);
    this.boss.hidden = boss === null;
    if (boss !== null) {
      this.bossFill.style.width = `${percent(boss.hp, boss.maxHp)}%`;
    }

    // The lull before the boss is silent otherwise: enemies simply stop
    // arriving, which reads as the game breaking rather than as a warning.
    const lullStart = world.nextBossAt - CONFIG.boss.lull;
    this.warning.hidden = !(
      world.phase === 'playing' &&
      !world.bossSpawned &&
      world.time >= lullStart
    );
  }
}

/**
 * Scans for the boss only once one exists. By then the spawner has stopped, so
 * the horde is shrinking and the linear scan costs less every frame.
 */
function findBoss(world: World): Enemy | null {
  if (!world.bossSpawned) return null;

  for (const enemy of world.enemies) {
    if (enemy.boss && enemy.hp > 0) return enemy;
  }

  return null;
}

/** Compact loadout readout: `bolt · orbit 3`. Level is omitted at level 1. */
function describeWeapons(world: World): string {
  const parts: string[] = [];

  for (const state of world.weapons) {
    const def = weaponById(state.defId);
    if (def === undefined) continue;
    parts.push(state.level > 1 ? `${def.id} ${state.level}` : def.id);
  }

  return parts.join(' · ');
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function percent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id} in index.html`);
  return element;
}
