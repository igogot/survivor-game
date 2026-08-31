import { Application, Container, Sprite, TilingSprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { CONFIG } from '../config';
import { TAU, lerp } from '../core/math';
import { viewToWorld } from '../core/steering';
import { orbitCount, orbitDistance, orbitRadius, weaponById } from '../data/weapons';
import { FLASH_TIME } from '../systems/damage';
import { GRID_TEXTURE_SIZE, createTextures } from './textures';
import type { TextureSet } from './textures';
import type { SpriteName } from '../data/sprites';
import type { MoveTarget } from '../world/types';
import type { World } from '../world/world';

const GEM_SIZE = 11;

/** Diameter of the mark left where a click sent the player, in world units. */
const MARKER_SIZE = 26;

/**
 * Ceiling on the backing-store scale.
 *
 * A phone reporting `devicePixelRatio` 3 asks for nine times the fragments of a
 * 1x screen for the same picture, and this scene is fill-bound: a full horde is
 * hundreds of overlapping translucent sprites. Two is where the extra pixels
 * stop being visible on a screen held at arm's length and start being the
 * difference between 60 fps and 30.
 */
const MAX_RESOLUTION = 2;

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
  private readonly flashLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly orbLayer = new Container();
  private readonly projectileLayer = new Container();

  private playerSprite!: Sprite;
  private markerSprite!: Sprite;
  private readonly enemySprites: Sprite[] = [];
  private readonly flashSprites: Sprite[] = [];
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
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
    });

    // The fixed-step loop decides when to render; Pixi's own ticker would
    // otherwise drive a second, competing frame schedule.
    this.app.ticker.stop();
    host.appendChild(this.app.canvas);

    this.textures = await createTextures();

    this.background = new TilingSprite({
      texture: this.textures.grid,
      width: this.app.screen.width,
      height: this.app.screen.height,
    });

    // The frame is chosen per draw from the world, because which figure the
    // player is depends on the weapon the run opened with and a restart can
    // change it.
    this.playerSprite = new Sprite(this.textures.sprites.playerBolt);
    this.playerSprite.anchor.set(0.5);
    // Artwork carries its own colour; only the white shapes need tinting into it.
    this.playerSprite.tint = this.variantTint(0x6ee7a0);

    this.markerSprite = new Sprite(this.textures.sprites.ring);
    this.markerSprite.anchor.set(0.5);
    // Kept faint on purpose: it is a note about the ground, and the player has
    // a horde to read. Tinted unconditionally — this is interface, not an
    // entity, so it stays the same colour whatever artwork is loaded.
    this.markerSprite.tint = 0x6ee7a0;
    this.markerSprite.alpha = 0.4;
    this.markerSprite.visible = false;
    fit(this.markerSprite, MARKER_SIZE);

    // The move marker sits under everything, gems included: it must never hide
    // something the player has to see. Then gems, then the horde. Shockwaves
    // draw over the horde or the crowd would swallow them; the player and their
    // blades stay on top of both.
    this.camera.addChild(
      this.markerSprite,
      this.gemLayer,
      this.enemyLayer,
      this.flashLayer,
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

    this.playerSprite.texture = this.textures.sprites[world.player.sprite];
    fit(this.playerSprite, CONFIG.player.radius * 2);
    this.playerSprite.position.set(playerX, playerY);
    this.playerSprite.alpha = world.player.invuln > 0 ? 0.45 : 1;

    // Drawn straight from the order rather than faded out on arrival: the mark
    // disappearing is how the player learns the order is spent.
    const target = world.moveTarget;
    this.markerSprite.visible = target !== null;
    if (target !== null) this.markerSprite.position.set(target.x, target.y);

    this.drawEnemies(world, alpha);
    this.drawProjectiles(world, alpha);
    this.drawGems(world, alpha);
    this.drawEffects(world, alpha);
    this.drawOrbs(world, playerX, playerY, alpha);

    this.app.renderer.render(this.app.stage);
  }

  /**
   * Draws one sprite onto a canvas, for interface outside the scene graph.
   *
   * A bound method, so the weapon picker can be handed this one capability
   * instead of the whole renderer.
   */
  paintSprite = (name: SpriteName, canvas: HTMLCanvasElement): void => {
    this.textures.paint(name, canvas);
  };

  /**
   * Turns a viewport position — a mouse event's client coordinates — into world
   * units.
   *
   * Reads the camera as it was last drawn rather than recomputing it from the
   * player. The click was aimed at a picture, and that picture is the last
   * frame, interpolation and all; deriving the camera again from the tick the
   * click landed in would answer a question nobody asked and miss by however
   * far the player moved in between.
   */
  screenToWorld(clientX: number, clientY: number): MoveTarget {
    const bounds = this.app.canvas.getBoundingClientRect();
    // The camera is only scaled once a frame has been drawn; until then it is
    // the identity, which is exactly what an unscaled reading should give.
    const zoom = this.camera.scale.x || 1;

    return viewToWorld(
      clientX - bounds.left,
      clientY - bounds.top,
      this.camera.x,
      this.camera.y,
      zoom,
    );
  }

  private drawEnemies(world: World, alpha: number): void {
    const enemies = world.enemies;
    this.resize(this.enemySprites, this.enemyLayer, enemies.length, this.textures.sprites.grunt);

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const sprite = this.enemySprites[i];
      // Every frame comes from the same source texture, so swapping the frame
      // per enemy costs nothing: the layer still batches into one draw call.
      sprite.texture = this.textures.sprites[enemy.sprite];
      sprite.position.set(lerp(enemy.px, enemy.x, alpha), lerp(enemy.py, enemy.y, alpha));
      fit(sprite, enemy.radius * 2);
      sprite.tint = this.variantTint(enemy.color);
    }

    this.drawFlashes(world, alpha);
  }

  /**
   * The hit flash, as a second pass over the enemies that are flashing.
   *
   * It used to be a white tint, which worked only because every sprite was a
   * white mask: tint multiplies, so on artwork the same white tint changes
   * nothing at all and the flash silently disappears. Adding a copy of the
   * frame on top brightens whatever is underneath instead of recolouring it,
   * which works for a mask and for a painted crab alike.
   *
   * The copies come from the same atlas texture, so this costs one draw call
   * regardless of how many enemies are being hit, and only the ones actually
   * flashing get a sprite.
   */
  private drawFlashes(world: World, alpha: number): void {
    const enemies = world.enemies;

    let needed = 0;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].flash > 0) needed++;
    }

    this.resize(this.flashSprites, this.flashLayer, needed, this.textures.sprites.grunt);

    let next = 0;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy.flash <= 0) continue;

      const sprite = this.flashSprites[next++];
      sprite.blendMode = 'add';
      sprite.texture = this.textures.sprites[enemy.sprite];
      sprite.position.set(lerp(enemy.px, enemy.x, alpha), lerp(enemy.py, enemy.y, alpha));
      fit(sprite, enemy.radius * 2);
      // Fades over the flash's own lifetime so a hit reads as a pulse.
      sprite.alpha = Math.min(1, enemy.flash / FLASH_TIME);
    }
  }

  /**
   * The tint a sprite should carry.
   *
   * Drawn shapes are white masks and become their colour by being tinted.
   * Artwork already is its colour, and tinting it would only darken it, so it
   * is left alone.
   */
  private variantTint(color: number): number {
    return this.textures.artwork ? 0xffffff : color;
  }

  private drawProjectiles(world: World, alpha: number): void {
    const projectiles = world.projectiles;
    this.resize(
      this.projectileSprites,
      this.projectileLayer,
      projectiles.length,
      this.textures.sprites.bolt,
    );

    for (let i = 0; i < projectiles.length; i++) {
      const projectile = projectiles[i];
      const sprite = this.projectileSprites[i];
      sprite.position.set(
        lerp(projectile.px, projectile.x, alpha),
        lerp(projectile.py, projectile.y, alpha),
      );
      // Per-projectile frame: a hex thrown at the player must not read as one
      // of their own bolts. Same source texture, so the layer still batches.
      sprite.texture = this.textures.sprites[projectile.sprite];
      fit(sprite, projectile.radius * 2);
      // The blade points up in the sheet; turn it to face where it is going.
      sprite.rotation = Math.atan2(projectile.vy, projectile.vx) + Math.PI / 2;
      sprite.tint = this.variantTint(projectile.color);
    }
  }

  private drawGems(world: World, alpha: number): void {
    const gems = world.gems;
    this.resize(this.gemSprites, this.gemLayer, gems.length, this.textures.sprites.gem);

    for (let i = 0; i < gems.length; i++) {
      const gem = gems[i];
      const sprite = this.gemSprites[i];
      const rich = gem.value > 1;

      // Worth telling apart by shape rather than by tint: a colour difference
      // is the first thing lost in a crowd, and it is lost entirely once the
      // sprites carry their own colour.
      sprite.texture = rich ? this.textures.sprites.gemRich : this.textures.sprites.gem;
      sprite.position.set(lerp(gem.px, gem.x, alpha), lerp(gem.py, gem.y, alpha));
      fit(sprite, GEM_SIZE);
      sprite.tint = this.variantTint(rich ? 0xffd166 : 0x66d9ff);
    }
  }

  private drawEffects(world: World, alpha: number): void {
    const effects = world.effects;
    this.resize(this.effectSprites, this.effectLayer, effects.length, this.textures.sprites.ring);

    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i];
      const sprite = this.effectSprites[i];
      const radius = lerp(effect.pradius, effect.radius, alpha);

      sprite.position.set(effect.x, effect.y);
      fit(sprite, radius * 2);
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

    this.resize(this.orbSprites, this.orbLayer, needed, this.textures.sprites.orb);

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
        fit(sprite, radius * 2);
        // Spinning with the ring, which is the whole read on the weapon.
        sprite.rotation = a;
        sprite.tint = this.variantTint(def.color);
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

/**
 * Scales a sprite so its frame covers `diameter` world units.
 *
 * Reading the size off the texture rather than from a constant means artwork
 * can change frame sizes without every call site having to agree on a number.
 */
function fit(sprite: Sprite, diameter: number): void {
  sprite.scale.set(diameter / sprite.texture.width);
}
