import { Application, Container, Sprite, TilingSprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { CONFIG } from '../config';
import { TAU, lerp } from '../core/math';
import { viewToWorld } from '../core/steering';
import {
  orbitCount,
  orbitDistance,
  orbitRadius,
  spearLength,
  spearThickness,
  weaponById,
} from '../data/weapons';
import { FLASH_TIME } from '../systems/damage';
import { EMBER_FRAMES } from './atlas';
import { GRID_TEXTURE_SIZE, createTextures } from './textures';
import type { TextureSet } from './textures';
import type { SpriteName } from '../data/sprites';
import type { MoveTarget, Player } from '../world/types';
import type { World } from '../world/world';

const GEM_SIZE = 11;

/** The player's own green, worn by the figure and by the mark it was sent to. */
const PLAYER_COLOR = 0x6ee7a0;

/**
 * Opacity of a freshly laid patch of fire.
 *
 * Well under half, because a trail is a few dozen overlapping patches and they
 * stack: four fresh ones on the same ground already come to nine tenths. Any
 * higher and the ribbon becomes a wall the player cannot see their own gems
 * through.
 */
const FLAME_ALPHA = 0.42;

/**
 * Seconds one ember frame is held.
 *
 * Nine a second: fast enough to read as fire rather than as a slideshow, slow
 * enough that a single frame is on screen for more than one drawn frame at
 * sixty hertz, which is what keeps it from turning into a blur.
 */
const EMBER_FRAME_TIME = 0.11;

/** Diameter of the mark left where a click sent the player, in world units. */
const MARKER_SIZE = 26;

/**
 * The gold a chest and everything pointing at it are drawn in.
 *
 * Only reached when the artwork failed and the frame is a white mask — the
 * sheet's own chest is already this colour. The HUD pointer and the spoil
 * cards repeat it in CSS, which is the one copy that cannot be shared.
 */
const CHEST_COLOR = 0xffd166;

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
  private readonly flameLayer = new Container();
  private readonly gemLayer = new Container();
  private readonly enemyLayer = new Container();
  private readonly flashLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly playerLayer = new Container();
  private readonly orbLayer = new Container();
  private readonly spearLayer = new Container();
  private readonly projectileLayer = new Container();

  private markerSprite!: Sprite;
  private chestSprite!: Sprite;
  private readonly playerSprites: Sprite[] = [];
  private readonly enemySprites: Sprite[] = [];
  private readonly flashSprites: Sprite[] = [];
  private readonly projectileSprites: Sprite[] = [];
  private readonly flameSprites: Sprite[] = [];
  private readonly gemSprites: Sprite[] = [];
  private readonly effectSprites: Sprite[] = [];
  private readonly orbSprites: Sprite[] = [];
  private readonly spearSprites: Sprite[] = [];

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

    this.markerSprite = new Sprite(this.textures.sprites.ring);
    this.markerSprite.anchor.set(0.5);
    // Kept faint on purpose: it is a note about the ground, and the player has
    // a horde to read. Tinted unconditionally — this is interface, not an
    // entity, so it stays the same colour whatever artwork is loaded.
    this.markerSprite.tint = PLAYER_COLOR;
    this.markerSprite.alpha = 0.4;
    this.markerSprite.visible = false;
    fit(this.markerSprite, MARKER_SIZE);

    this.chestSprite = new Sprite(this.textures.sprites.chest);
    this.chestSprite.anchor.set(0.5);
    // Per frame rather than per run: the chest comes out of the sheet when
    // there is one, so `tintFor` leaves it alone, and paints the drawn box
    // gold when there is not.
    this.chestSprite.tint = this.tintFor('chest', CHEST_COLOR);
    this.chestSprite.visible = false;
    fit(this.chestSprite, CONFIG.chest.radius * 2);

    // The move marker sits under everything, gems included: it must never hide
    // something the player has to see. Then the burning ground, which is
    // ground — it must not cover a gem lying in it or an enemy walking through
    // it. Then the chest, which stands on that ground rather than being it: a
    // flame patch swallowing the one thing the player is walking towards would
    // cost more than a chest hiding a patch of fire. Both stay under the horde,
    // because a crowd standing on the chest is information — it says what the
    // trip is going to cost. Then gems, then the horde. Shockwaves draw over
    // the horde or the crowd would swallow them; the player and their blades
    // stay on top of both.
    this.camera.addChild(
      this.markerSprite,
      this.flameLayer,
      this.chestSprite,
      this.gemLayer,
      this.enemyLayer,
      this.flashLayer,
      this.effectLayer,
      this.playerLayer,
      this.orbLayer,
      this.spearLayer,
      this.projectileLayer,
    );
    this.app.stage.addChild(this.background, this.camera);
  }

  /**
   * Draws the world through one player's eyes.
   *
   * `view` is whose screen this is: the camera follows them and the move marker
   * is theirs, while every player in the world is drawn. The renderer is told
   * rather than asking, because "which player am I" is a fact about the client
   * and not about the world — the same world object is what a host would send
   * to three other people, each of whom would draw it through a different one.
   *
   * `alpha` is the fraction of a tick left in the accumulator.
   */
  draw(world: World, view: Player, alpha: number): void {
    const screen = this.app.screen;
    this.background.width = screen.width;
    this.background.height = screen.height;

    const viewX = lerp(view.px, view.x, alpha);
    const viewY = lerp(view.py, view.y, alpha);

    const zoom = CONFIG.camera.zoom;
    const cameraX = screen.width / 2 - viewX * zoom;
    const cameraY = screen.height / 2 - viewY * zoom;

    this.camera.scale.set(zoom);
    this.camera.position.set(cameraX, cameraY);
    // Scrolling the tile offset instead of moving a huge sprite keeps the
    // background one draw call regardless of how far the player has travelled.
    this.background.tilePosition.set(cameraX % GRID_TEXTURE_SIZE, cameraY % GRID_TEXTURE_SIZE);

    // Drawn straight from the order rather than faded out on arrival: the mark
    // disappearing is how the player learns the order is spent. Only the
    // viewer's own — somebody else's walking orders are not this screen's news.
    const target = view.moveTarget;
    this.markerSprite.visible = target !== null;
    if (target !== null) this.markerSprite.position.set(target.x, target.y);

    // Drawn straight from its position with no interpolation: it is the one
    // thing in the world that does not move, so there is nothing between two
    // ticks to interpolate.
    const chest = world.chest;
    this.chestSprite.visible = chest !== null;
    if (chest !== null) this.chestSprite.position.set(chest.x, chest.y);

    this.drawFlames(world);
    this.drawEnemies(world, alpha);
    this.drawPlayers(world, alpha);
    this.drawProjectiles(world, alpha);
    this.drawGems(world, alpha);
    this.drawEffects(world, alpha);
    this.drawOrbs(world, alpha);
    this.drawSpears(world, alpha);

    this.app.renderer.render(this.app.stage);
  }

  /**
   * Every player on the field, the viewer included.
   *
   * Pooled by index like the horde is. The frame is chosen per draw rather than
   * once at startup, because which figure a player is depends on the weapon
   * their run opened with, and a restart can change it.
   */
  private drawPlayers(world: World, alpha: number): void {
    const players = world.players;
    this.resize(
      this.playerSprites,
      this.playerLayer,
      players.length,
      this.textures.sprites.playerBolt,
    );

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const sprite = this.playerSprites[i];

      sprite.texture = this.textures.sprites[player.sprite];
      sprite.tint = this.tintFor(player.sprite, PLAYER_COLOR);
      fit(sprite, CONFIG.player.radius * 2);
      sprite.position.set(lerp(player.px, player.x, alpha), lerp(player.py, player.y, alpha));
      sprite.alpha = player.invuln > 0 ? 0.45 : 1;
    }
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

  /**
   * The burning ground, drawn exactly where it burns.
   *
   * No interpolation, because a patch never moves — and no shrinking as it
   * dies, only fading. The radius on screen is the radius that damages, which
   * is this project's rule for every weapon; a patch that visibly narrowed
   * while still burning its full width would be the blade ring's old lie in a
   * different shape.
   *
   * Two things stop a ribbon from reading as a row of identical blobs, and
   * both are pure functions of where a patch lies: which of the four frames it
   * starts on, and which quarter turn it is drawn at. Neither costs the world
   * anything to store and neither takes a random draw — which matters, because
   * a draw here would move every seed in the balance table.
   *
   * Quarter turns and not the free angle this used to use. The frame is pixel
   * art now, and pixel art turned by an arbitrary angle stops being pixel art:
   * the grid smears into a gradient. A quarter turn maps whole cells onto whole
   * cells, so four of them are four sharp pictures rather than one soft one.
   *
   * The flicker runs on `world.time` rather than a wall clock, so it stops with
   * the run: fire dancing over a paused game is a game that looks like it is
   * still going.
   */
  private drawFlames(world: World): void {
    const flames = world.flames;
    this.resize(this.flameSprites, this.flameLayer, flames.length, this.textures.sprites.ember);

    const step = Math.floor(world.time / EMBER_FRAME_TIME);

    for (let i = 0; i < flames.length; i++) {
      const flame = flames[i];
      const sprite = this.flameSprites[i];

      // Two readings of the same position, kept apart on purpose: one key for
      // both would tie a patch's frame to its rotation, and the ribbon would
      // show four combinations instead of sixteen.
      const phase = hash(flame.x * 0.17 + flame.y * 0.53) % EMBER_FRAMES.length;
      const turn = hash(flame.x * 0.41 + flame.y * 0.29) % 4;

      sprite.texture = this.textures.sprites[EMBER_FRAMES[(phase + step) % EMBER_FRAMES.length]];
      sprite.position.set(flame.x, flame.y);
      fit(sprite, flame.radius * 2);
      sprite.rotation = turn * (Math.PI / 2);
      sprite.tint = this.tintFor('ember', flame.color);
      // Fading out is how a patch says it is nearly spent, and the only warning
      // a player gets that the ground behind them has gone cold.
      sprite.alpha = FLAME_ALPHA * (flame.life / flame.maxLife);
    }
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
      sprite.tint = this.tintFor(enemy.sprite, enemy.color);
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
   * The tint a frame should carry.
   *
   * Drawn shapes are white masks and become their colour by being tinted.
   * Artwork already is its colour, and tinting it could only darken it, so it
   * is left alone. Which of the two a frame is depends on the frame and not on
   * the run: the shockwave, the lance and the harpoon stay drawn even when the
   * sheet loaded, and each of them used to need its own exception here.
   */
  private tintFor(name: SpriteName, color: number): number {
    return this.textures.masked(name) ? color : 0xffffff;
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
      sprite.tint = this.tintFor(projectile.sprite, projectile.color);
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
      const frame: SpriteName = rich ? 'gemRich' : 'gem';
      sprite.texture = this.textures.sprites[frame];
      sprite.position.set(lerp(gem.px, gem.x, alpha), lerp(gem.py, gem.y, alpha));
      fit(sprite, GEM_SIZE);
      sprite.tint = this.tintFor(frame, rich ? 0xffd166 : 0x66d9ff);
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
      sprite.tint = this.tintFor('ring', effect.color);
      // Fades as it expands, so the burst reads as one motion.
      sprite.alpha = Math.max(0, effect.life / effect.maxLife);
    }
  }

  /**
   * Orbiting blades have no entity behind them — their positions are recomputed
   * from the weapon's angle using the same helpers the damage pulse used, which
   * is what guarantees a blade hits exactly where it is drawn.
   */
  private drawOrbs(world: World, alpha: number): void {
    const players = world.players;

    let needed = 0;
    for (let p = 0; p < players.length; p++) {
      const weapons = players[p].weapons;
      for (let i = 0; i < weapons.length; i++) {
        const def = weaponById(weapons[i].defId);
        if (def === undefined || def.kind !== 'orbit') continue;
        needed += orbitCount(def, weapons[i]);
      }
    }

    this.resize(this.orbSprites, this.orbLayer, needed, this.textures.sprites.orb);

    let next = 0;
    for (let p = 0; p < players.length; p++) {
      const player = players[p];
      // The ring is drawn around its owner, interpolated the same way the
      // figure inside it is — otherwise a moving player's guard trails them by
      // a fraction of a tick.
      const ownerX = lerp(player.px, player.x, alpha);
      const ownerY = lerp(player.py, player.y, alpha);
      const weapons = player.weapons;

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
          sprite.position.set(ownerX + Math.cos(a) * distance, ownerY + Math.sin(a) * distance);
          fit(sprite, radius * 2);
          // Spinning with the ring, which is the whole read on the weapon.
          sprite.rotation = a;
          sprite.tint = this.tintFor('orb', def.color);
        }
      }
    }
  }

  /**
   * The lance, drawn from the same two numbers the thrust used.
   *
   * Like the blades it has no entity behind it: `angle` is where the damage
   * went and `swing` is how much of the flash is left, so the lance cannot be
   * drawn anywhere other than where it hit. Only weapons mid-thrust take a
   * sprite, which is why the pool stays at one per spear rather than one per
   * frame of animation.
   */
  private drawSpears(world: World, alpha: number): void {
    const players = world.players;

    let needed = 0;
    for (let p = 0; p < players.length; p++) {
      const weapons = players[p].weapons;
      for (let i = 0; i < weapons.length; i++) {
        const def = weaponById(weapons[i].defId);
        if (def === undefined || def.kind !== 'spear') continue;
        if (weapons[i].swing > 0) needed++;
      }
    }

    this.resize(this.spearSprites, this.spearLayer, needed, this.textures.sprites.spear);

    let next = 0;
    for (let p = 0; p < players.length; p++) {
      const player = players[p];
      const ownerX = lerp(player.px, player.x, alpha);
      const ownerY = lerp(player.py, player.y, alpha);
      const weapons = player.weapons;

      for (let i = 0; i < weapons.length; i++) {
        const state = weapons[i];
        const def = weaponById(state.defId);
        if (def === undefined || def.kind !== 'spear' || state.swing <= 0) continue;

        const length = spearLength(def, state);
        const thickness = spearThickness(def, state);
        const dx = Math.cos(state.angle);
        const dy = Math.sin(state.angle);
        const sprite = this.spearSprites[next++];

        // Anchored in the middle like every other sprite, so the lance is placed
        // at the midpoint of the line the damage swept.
        sprite.position.set(ownerX + (dx * length) / 2, ownerY + (dy * length) / 2);
        sprite.rotation = state.angle;
        // Not `fit`: this is the one frame that is not scaled uniformly — it has
        // to be exactly as long and as wide as the thrust that landed.
        sprite.scale.set(
          length / sprite.texture.width,
          (thickness * 2) / sprite.texture.height,
        );
        sprite.tint = this.tintFor('spear', def.color);
        // Fades over the thrust rather than blinking out, so a fast spear reads
        // as a rhythm instead of a strobe.
        sprite.alpha = state.swing / def.swingTime;
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
 * A small whole number from a coordinate, for picking a frame or a turn.
 *
 * A patch never moves, so the answer is fixed for its whole life — the fire
 * flickers because the clock advances, not because the ground wanders.
 */
function hash(value: number): number {
  return Math.abs(Math.round(value));
}

/**
 * Scales a sprite so its frame covers `diameter` world units.
 *
 * Reading the size off the texture rather than from a constant means artwork
 * can change frame sizes without every call site having to agree on a number.
 *
 * Square frames only, which is everything a circle is fitted into. The lance
 * is the one frame that is not square, and it is also the one sprite that sets
 * its own scale, because what it has to match is a thrust rather than a body.
 */
function fit(sprite: Sprite, diameter: number): void {
  sprite.scale.set(diameter / sprite.texture.width);
}
