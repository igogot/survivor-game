import { Application, Container, Sprite, TilingSprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { CONFIG } from '../config';
import { TAU, lerp } from '../core/math';
import { orbitCount, orbitDistance, orbitRadius, weaponById } from '../data/weapons';
import {
  CIRCLE_TEXTURE_SIZE,
  GEM_TEXTURE_SIZE,
  GRID_TEXTURE_SIZE,
  RING_TEXTURE_SIZE,
  createTextures,
} from './textures';
import type { TextureSet } from './textures';
import type { World } from '../world/world';

const GEM_SIZE = 11;

/**
 * Draws a `World`. Reads it, never mutates it.
 *
 * That one-way dependency is what keeps the simulation testable in Node — this
 * file is the only place in the project that imports Pixi.
 *
 * Sprites are pooled per layer and mirrored onto the entity arrays by index.
 * Entities never move between indices within a tick, so index i in
 * `world.enemies` always maps to index i in `enemySprites`.
 */
export class GameRenderer {
  readonly app = new Application();

  private textures!: TextureSet;
  private background!: TilingSprite;

  private readonly camera = new Container();
  private readonly gemLayer = new Container();
  private readonly enemyLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly orbLayer = new Container();
  private readonly projectileLayer = new Container();

  private playerSprite!: Sprite;
  private readonly enemySprites: Sprite[] = [];
  private readonly projectileSprites: Sprite[] = [];
  private readonly gemSprites: Sprite[] = [];
  private readonly effectSprites: Sprite[] = [];
  private readonly orbSprites: Sprite[] = [];

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x0b0d13,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    // The fixed-step loop decides when to render; Pixi's own ticker would
    // otherwise drive a second, competing frame schedule.
    this.app.ticker.stop();
    host.appendChild(this.app.canvas);

    this.textures = createTextures();

    this.background = new TilingSprite({
      texture: this.textures.grid,
      width: this.app.screen.width,
      height: this.app.screen.height,
    });

    this.playerSprite = new Sprite(this.textures.circle);
    this.playerSprite.anchor.set(0.5);
    this.playerSprite.tint = 0x6ee7a0;
    this.playerSprite.scale.set((CONFIG.player.radius * 2) / CIRCLE_TEXTURE_SIZE);

    // Gems at the bottom, then the horde. Shockwaves draw over the horde or the
    // crowd would swallow them; the player and their blades stay on top of both.
    this.camera.addChild(
      this.gemLayer,
      this.enemyLayer,
      this.effectLayer,
      this.playerSprite,
      this.orbLayer,
      this.projectileLayer,
    );
    this.app.stage.addChild(this.background, this.camera);
  }

  /** `alpha` is the fraction of a tick left in the accumulator. */
  draw(world: World, alpha: number): void {
    const screen = this.app.screen;
    this.background.width = screen.width;
    this.background.height = screen.height;

    const playerX = lerp(world.player.px, world.player.x, alpha);
    const playerY = lerp(world.player.py, world.player.y, alpha);

    const zoom = CONFIG.camera.zoom;
    const cameraX = screen.width / 2 - playerX * zoom;
    const cameraY = screen.height / 2 - playerY * zoom;

    this.camera.scale.set(zoom);
    this.camera.position.set(cameraX, cameraY);
    // Scrolling the tile offset instead of moving a huge sprite keeps the
    // background one draw call regardless of how far the player has travelled.
    this.background.tilePosition.set(cameraX % GRID_TEXTURE_SIZE, cameraY % GRID_TEXTURE_SIZE);

    this.playerSprite.position.set(playerX, playerY);
    this.playerSprite.alpha = world.player.invuln > 0 ? 0.45 : 1;

    this.drawEnemies(world, alpha);
    this.drawProjectiles(world, alpha);
    this.drawGems(world, alpha);
    this.drawEffects(world, alpha);
    this.drawOrbs(world, playerX, playerY, alpha);

    this.app.renderer.render(this.app.stage);
  }

  private drawEnemies(world: World, alpha: number): void {
    const enemies = world.enemies;
    this.resize(this.enemySprites, this.enemyLayer, enemies.length, this.textures.circle);

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const sprite = this.enemySprites[i];
      sprite.position.set(lerp(enemy.px, enemy.x, alpha), lerp(enemy.py, enemy.y, alpha));
      sprite.scale.set((enemy.radius * 2) / CIRCLE_TEXTURE_SIZE);
      sprite.tint = enemy.flash > 0 ? 0xffffff : enemy.color;
    }
  }

  private drawProjectiles(world: World, alpha: number): void {
    const projectiles = world.projectiles;
    this.resize(
      this.projectileSprites,
      this.projectileLayer,
      projectiles.length,
      this.textures.circle,
    );

    for (let i = 0; i < projectiles.length; i++) {
      const projectile = projectiles[i];
      const sprite = this.projectileSprites[i];
      sprite.position.set(
        lerp(projectile.px, projectile.x, alpha),
        lerp(projectile.py, projectile.y, alpha),
      );
      sprite.scale.set((projectile.radius * 2) / CIRCLE_TEXTURE_SIZE);
      sprite.tint = projectile.color;
    }
  }

  private drawGems(world: World, alpha: number): void {
    const gems = world.gems;
    this.resize(this.gemSprites, this.gemLayer, gems.length, this.textures.gem);

    for (let i = 0; i < gems.length; i++) {
      const gem = gems[i];
      const sprite = this.gemSprites[i];
      sprite.position.set(lerp(gem.px, gem.x, alpha), lerp(gem.py, gem.y, alpha));
      sprite.scale.set(GEM_SIZE / GEM_TEXTURE_SIZE);
      sprite.tint = gem.value > 1 ? 0xffd166 : 0x66d9ff;
    }
  }

  private drawEffects(world: World, alpha: number): void {
    const effects = world.effects;
    this.resize(this.effectSprites, this.effectLayer, effects.length, this.textures.ring);

    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i];
      const sprite = this.effectSprites[i];
      const radius = lerp(effect.pradius, effect.radius, alpha);

      sprite.position.set(effect.x, effect.y);
      sprite.scale.set((radius * 2) / RING_TEXTURE_SIZE);
      sprite.tint = effect.color;
      // Fades as it expands, so the burst reads as one motion.
      sprite.alpha = Math.max(0, effect.life / effect.maxLife);
    }
  }

  /**
   * Orbiting blades have no entity behind them — their positions are recomputed
   * from the weapon's angle using the same helpers the damage pulse used, which
   * is what guarantees a blade hits exactly where it is drawn.
   */
  private drawOrbs(world: World, playerX: number, playerY: number, alpha: number): void {
    const weapons = world.weapons;

    let needed = 0;
    for (let i = 0; i < weapons.length; i++) {
      const def = weaponById(weapons[i].defId);
      if (def === undefined || def.kind !== 'orbit') continue;
      needed += orbitCount(def, weapons[i]);
    }

    this.resize(this.orbSprites, this.orbLayer, needed, this.textures.circle);

    let next = 0;
    for (let i = 0; i < weapons.length; i++) {
      const state = weapons[i];
      const def = weaponById(state.defId);
      if (def === undefined || def.kind !== 'orbit') continue;

      const count = orbitCount(def, state);
      const distance = orbitDistance(def, state);
      const radius = orbitRadius(def, state);
      const angle = lerp(state.pangle, state.angle, alpha);

      for (let orb = 0; orb < count; orb++) {
        const a = angle + (orb * TAU) / count;
        const sprite = this.orbSprites[next++];
        sprite.position.set(
          playerX + Math.cos(a) * distance,
          playerY + Math.sin(a) * distance,
        );
        sprite.scale.set((radius * 2) / CIRCLE_TEXTURE_SIZE);
        sprite.tint = def.color;
      }
    }
  }

  /**
   * Grows the sprite pool to cover `needed` entities and hides the surplus.
   * Sprites are never destroyed — the peak count is reached early in a run and
   * reused for the rest of it.
   */
  private resize(pool: Sprite[], layer: Container, needed: number, texture: Texture): void {
    while (pool.length < needed) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      pool.push(sprite);
      layer.addChild(sprite);
    }
    for (let i = 0; i < pool.length; i++) {
      pool[i].visible = i < needed;
    }
  }
}
