import { CONFIG } from '../config';
import { weaponById } from '../data/weapons';
import { t } from '../i18n';
import { xpForNextLevel } from '../systems/progression';
import { isAlive } from '../world/party';
import { edgeMark } from './offscreen';
import { loadIdentity, onIdentityChange } from '../net/identity';
import type { SpritePainter } from './starters';
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

/** How far the chest pointer stays clear of the edge of the glass, in pixels. */
const MARKER_INSET = 56;
/**
 * How far it stays clear of the top, where the HUD is.
 *
 * The health bar, the level badge and the stat row all live in that strip, and
 * a marker sitting on them is unreadable twice over. Everything else the HUD
 * puts on the glass is either transparent to it or in a corner.
 */
const MARKER_TOP_INSET = 110;
/** Smallest region the marker will be confined to, so a tiny window still works. */
const MARKER_MIN_REACH = 24;
/** How far the arrow sits from the middle of the badge it points away from. */
const ARROW_REACH = 26;
/** Side of the chest icon painted into the pointer, matching its atlas frame. */
const MARKER_ART_SIZE = 48;

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
  private readonly bossName = requireElement('boss-name');
  private readonly bossFill = requireElement('boss-fill');
  private readonly warning = requireElement('warning');
  private readonly chestMarker = requireElement('chest-marker');
  private readonly downed = requireElement('downed');
  private readonly chestArrow = requireElement('chest-arrow');
  private readonly playerName = requireElement('player-name');

  /** Exponential moving average — a raw per-frame value is unreadable. */
  private smoothedFps = 60;
  private lastFrameTime = 0;

  /** Where the trailing chunk of the HP bar currently sits, as a percentage. */
  private ghost = 100;
  private lastMaxHp = 0;

  /**
   * Painted once, from the same source the atlas uses.
   *
   * The pointer shows the chest itself rather than a symbol standing in for
   * one, so there is nothing to learn: whatever is at the end of the arrow is
   * what the arrow is drawn as.
   */
  constructor(paint: SpritePainter) {
    /*
     * The name a run will be submitted under, kept on screen.
     *
     * Somebody who signed in ten minutes ago has no other way to remember that
     * this run is going onto the board as them, and the moment to find out is
     * not after dying under a name they did not expect.
     *
     * Driven by a subscription rather than read in `update`, which runs sixty
     * times a second and would ask storage the same question every frame.
     *
     * Set up before the icon below, which returns early when the canvas is
     * missing — putting this after it would make the name depend on a chest
     * marker having painted.
     */
    this.showName(loadIdentity());
    onIdentityChange((identity) => this.showName(identity));

    const icon = requireElement('chest-icon');
    if (!(icon instanceof HTMLCanvasElement)) return;
    // Sized here rather than in the markup, and painted at the frame's own
    // size to be scaled down by CSS: the artwork is 16px pixel art, and
    // letting a canvas do the scaling would blur it.
    icon.width = MARKER_ART_SIZE;
    icon.height = MARKER_ART_SIZE;
    paint('chest', icon);
  }

  /**
   * `view` is whose eyes this screen is using and `self` is who is sitting at
   * it. They are the same player until that player dies, and after that the
   * bars belong to whoever is being watched while the notices still belong to
   * the person watching — which is the whole difference between spectating and
   * having been replaced.
   */
  update(world: World, view: Player, self: Player = view): void {
    const now = performance.now();
    const elapsed = this.lastFrameTime > 0 ? (now - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = now;
    if (elapsed > 0) this.smoothedFps += (1 / elapsed - this.smoothedFps) * 0.05;

    const player = view;

    // The party's level, not the viewer's — there is one bar and one level.
    this.level.textContent = `${t('hud.level')} ${world.level}`;
    // Clamped: a tab returning from the background must not teleport the drain.
    this.updateHealth(player, Math.min(elapsed, 0.1));
    // One bar for the party, so it is read off the run and not off the
    // viewer — see `World.level`.
    this.xpFill.style.width = `${percent(world.xp, xpForNextLevel(world))}%`;

    // Unclamped: the run has no end for it to stop at.
    this.timer.textContent = formatTime(world.time);
    this.weapons.textContent = describeWeapons(view);
    this.kills.textContent = `${t('hud.kills')} ${world.kills}`;

    // Hidden until there is one, otherwise it is a zero the player carries for
    // the first ten minutes of every run.
    this.bosses.textContent = `${t('hud.bosses')} ${world.bossesKilled}`;
    this.bosses.hidden = world.bossesKilled === 0;
    this.entities.textContent = `${t('hud.enemies')} ${world.enemies.length}`;

    // Surfaced deliberately: `allocated` should plateau while the game keeps
    // spawning. If it climbs all run, the pool is leaking.
    this.pool.textContent = `${t('hud.pool')} ${world.enemyPool.allocated}`;
    this.fps.textContent = `${Math.round(this.smoothedFps)} fps`;

    this.updateBoss(world);
    this.updateChest(world, view);
    this.updateDowned(world, self);
  }

  /**
   * Who is down, and for how long.
   *
   * One line per fallen player rather than a banner that flashes once: it is
   * true for the whole minute, and somebody who looked away for ten seconds
   * should not have missed the only time the game said it. The viewer's own
   * death gets a second line, because being dead comes with a control nothing
   * else on the screen has.
   */
  private updateDowned(world: World, self: Player): void {
    const lines: HTMLElement[] = [];

    for (let i = 0; i < world.players.length; i++) {
      const player = world.players[i];
      if (isAlive(player)) continue;

      const line = document.createElement('div');
      line.textContent = t('hud.down', {
        who: t('hud.player', { n: i + 1 }),
        clock: formatTime(Math.max(0, player.respawnAt - world.time)),
      });
      lines.push(line);
    }

    if (!isAlive(self)) {
      const watched = world.players[self.watching];
      if (watched !== undefined) {
        const line = document.createElement('div');
        line.className = 'watching';
        line.textContent = t('hud.watching', {
          who: t('hud.player', { n: self.watching + 1 }),
        });
        lines.push(line);
      }
    }

    this.downed.replaceChildren(...lines);
  }

  /**
   * Points at the chest for as long as there is one.
   *
   * Hidden while the chest is on screen, because then the chest is the marker.
   * The camera is centred on the viewer and never rotates, so the direction on
   * screen is the direction in the world and this needs nothing from the
   * renderer — just the two positions and the size of the window.
   *
   * Drawn from the viewer's own position: with a party the chest is one place,
   * but which way it lies is a different answer for each of them.
   */
  /**
   * Shows the held name, or nothing at all.
   *
   * Nothing is the common case: a player who has never touched the board holds
   * no name, and an empty chip beside the level would be a widget explaining
   * itself. Both halves are required — a name without its token is one this
   * browser cannot actually submit under, so showing it would promise a place
   * on the board that the server would refuse.
   */
  private showName(identity: { name: string; token: string }): void {
    const holds = identity.name !== '' && identity.token !== '';
    this.playerName.hidden = !holds;
    this.playerName.textContent = holds ? identity.name : '';
  }

  private updateChest(world: World, view: Player): void {
    const chest = world.chest;
    if (chest === null) {
      this.chestMarker.hidden = true;
      return;
    }

    const zoom = CONFIG.camera.zoom;
    const halfWidth = window.innerWidth / 2;
    const halfHeight = window.innerHeight / 2;
    const reach = (half: number, inset: number): number =>
      Math.max(MARKER_MIN_REACH, half - inset);

    const mark = edgeMark((chest.x - view.x) * zoom, (chest.y - view.y) * zoom, {
      left: reach(halfWidth, MARKER_INSET),
      right: reach(halfWidth, MARKER_INSET),
      top: reach(halfHeight, MARKER_TOP_INSET),
      bottom: reach(halfHeight, MARKER_INSET),
    });

    this.chestMarker.hidden = mark.onScreen;
    if (mark.onScreen) return;

    // Half its own size back, so the badge is centred on the point rather than
    // hanging off it — the offset is measured to the middle of the marker.
    this.chestMarker.style.transform =
      `translate(calc(-50% + ${mark.x}px), calc(-50% + ${mark.y}px))`;
    // Rotated first, so the arrow is then pushed out along its own axis and
    // ends up beyond the badge pointing the way the player has to walk.
    this.chestArrow.style.transform = `rotate(${mark.angle}rad) translateX(${ARROW_REACH}px)`;
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
      this.bossName.textContent = bossTitle(boss.ability);
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
 * What the bar over the boss says it is.
 *
 * The horde's own name, then the ability, because the second half is the part
 * that changes and the part the player has to react to. An unknown id falls
 * back to the plain name rather than printing a blank: a boss with no title is
 * better than a title that is a gap.
 */
function bossTitle(ability: string): string {
  const id = `boss.${ability}`;
  if (!isBossTitle(id)) return t('hud.bossName');
  return `${t('hud.bossName')} · ${t(id)}`;
}

function isBossTitle(id: string): id is BossTitleId {
  return BOSS_TITLES.includes(id as BossTitleId);
}

type BossTitleId = (typeof BOSS_TITLES)[number];

/**
 * Listed rather than derived, because `t` takes a known id and a template
 * string is not one. `tests/boss.test.ts` checks the list against the
 * abilities, so an ability added without a name here stops being silent.
 */
const BOSS_TITLES = [
  'boss.charge',
  'boss.summon',
  'boss.volley',
  'boss.burst',
  'boss.quake',
  'boss.enrage',
  'boss.leech',
  'boss.blink',
  'boss.ward',
  'boss.thorns',
] as const;

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
function describeWeapons(player: Player): string {
  const parts: string[] = [];

  for (const state of player.weapons) {
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
