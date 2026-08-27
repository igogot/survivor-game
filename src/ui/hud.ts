import { CONFIG } from '../config';
import { weaponById } from '../data/weapons';
import type { Enemy } from '../world/types';
import type { World } from '../world/world';

/**
 * The HUD is plain DOM rather than Pixi text.
 *
 * Text in WebGL means font atlases and blurry glyphs at odd resolutions, and
 * the HUD is static enough that the browser's own layout engine is both
 * sharper and less code. It sits in an overlay with `pointer-events: none` so
 * it never steals input from the canvas.
 */
export class Hud {
  private readonly level = requireElement('level');
  private readonly hpFill = requireElement('hp-fill');
  private readonly hpText = requireElement('hp-text');
  private readonly xpFill = requireElement('xp-fill');
  private readonly timer = requireElement('timer');
  private readonly weapons = requireElement('stat-weapons');
  private readonly kills = requireElement('stat-kills');
  private readonly entities = requireElement('stat-entities');
  private readonly pool = requireElement('stat-pool');
  private readonly fps = requireElement('stat-fps');
  private readonly boss = requireElement('boss');
  private readonly bossFill = requireElement('boss-fill');
  private readonly warning = requireElement('warning');

  /** Exponential moving average — a raw per-frame value is unreadable. */
  private smoothedFps = 60;
  private lastFrameTime = 0;

  update(world: World): void {
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime;
      if (delta > 0) this.smoothedFps += (1000 / delta - this.smoothedFps) * 0.05;
    }
    this.lastFrameTime = now;

    const player = world.player;

    this.level.textContent = `LV ${player.level}`;
    this.hpFill.style.width = `${percent(player.hp, player.stats.maxHp)}%`;
    this.hpText.textContent = `${Math.ceil(player.hp)} / ${Math.round(player.stats.maxHp)}`;
    this.xpFill.style.width = `${percent(player.xp, player.xpToNext)}%`;

    this.timer.textContent = formatTime(Math.min(world.time, CONFIG.runDuration));
    this.weapons.textContent = describeWeapons(world);
    this.kills.textContent = `kills ${world.kills}`;
    this.entities.textContent = `enemies ${world.enemies.length}`;

    // Surfaced deliberately: `allocated` should plateau while the game keeps
    // spawning. If it climbs all run, the pool is leaking.
    this.pool.textContent = `pool ${world.enemyPool.allocated}`;
    this.fps.textContent = `${Math.round(this.smoothedFps)} fps`;

    this.updateBoss(world);
  }

  private updateBoss(world: World): void {
    const boss = findBoss(world);
    this.boss.hidden = boss === null;
    if (boss !== null) {
      this.bossFill.style.width = `${percent(boss.hp, boss.maxHp)}%`;
    }

    // The lull before the boss is silent otherwise: enemies simply stop
    // arriving, which reads as the game breaking rather than as a warning.
    const lullStart = CONFIG.runDuration - CONFIG.spawn.bossLull;
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
