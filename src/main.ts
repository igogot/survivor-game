import { CONFIG } from './config';
import { ClickInput } from './core/click-input';
import { GameLoop } from './core/loop';
import { autoPauseDisabled } from './dev/flags';
import { Input } from './core/input';
import { TouchInput } from './core/touch-input';
import { GameRenderer } from './render/renderer';
import { STARTER_WEAPON_ID } from './data/weapons';
import { applyStaticText } from './i18n';
import { getLang, initLang } from './i18n/lang';
import { OFFERS_PER_LEVEL, applyUpgrade } from './systems/progression';
import { takeSpoil } from './systems/chests';
import { mountLanguageSwitch } from './ui/language';
import { Hud } from './ui/hud';
import {
  ChestMenu,
  PauseScreen,
  ResultScreen,
  StartScreen,
  UpgradeMenu,
  mountHelp,
  renderKeyLines,
} from './ui/menus';
import { StickView } from './ui/stick';
import { starterChoices } from './ui/starters';
import { canPause, pauseRun, resumeRun } from './world/pause';
import { stepWorld } from './world/step';
import { World } from './world/world';
import type { Player } from './world/types';

async function main(): Promise<void> {
  const host = document.getElementById('app');
  if (host === null) throw new Error('Missing #app in index.html');

  // Before anything reads a string. Every screen below is built out of text,
  // and text is read from whichever table this call selects — so a language
  // decided after the first panel exists is a panel in the wrong language.
  initLang(window.location.search);

  const renderer = new GameRenderer();
  await renderer.init(host);

  const input = new Input();
  input.attach();

  // The canvas, not the window: the HUD is `pointer-events: none` and passes
  // touches through, but the buttons and cards layered over it are not, so a
  // tap meant for a card never also starts the stick under it.
  const touch = new TouchInput();
  touch.attach(host);

  // Same surface, same reason: a right-click meant for a card or the pause
  // button must not also order a walk to the ground behind it.
  const clicks = new ClickInput();
  clicks.attach(host);

  const hud = new Hud(renderer.paintSprite);
  const stick = new StickView();
  const resultScreen = new ResultScreen(restart);
  const pauseScreen = new PauseScreen(resumeGame, restart);
  const upgradeMenu = new UpgradeMenu(pickUpgrade);
  const chestMenu = new ChestMenu(pickSpoil);
  const startScreen = new StartScreen(startRun, renderer.paintSprite);

  /** The weapons on offer, in the order their cards and their keys appear. */
  const starters = starterChoices();

  // One source of rules, printed into the briefing, the pause screen and the
  // result screen. Put on the page by `relabel` below, once there is a world
  // for it to sync the overlays against.

  const pauseButton = document.getElementById('pause-button');
  pauseButton?.addEventListener('click', togglePause);

  /**
   * Whether a machine is driving this page.
   *
   * The same dev flag that unwires auto-pause also skips the briefing: both
   * exist because a harness has no eyes to read with and no hand to dismiss a
   * screen. A player cannot reach it — the flag is inert outside a dev build.
   */
  const unattended = autoPauseDisabled(window.location.search, import.meta.env.DEV);

  // Reassigned on restart, so every closure below reads the binding rather than
  // capturing one instance.
  let world = newWorld();

  /**
   * The player at this keyboard.
   *
   * A function rather than a binding because `world` is replaced on restart,
   * and index zero because a solo run has exactly one. It is the single place
   * this file decides whose screen it is drawing, which is what a second
   * participant would have to change and nothing else.
   */
  function me(): Player {
    return world.players[0];
  }

  /** The player whose level-up menu is up, or null when nobody's is. */
  function chooser(): Player | null {
    return world.players[world.choosing] ?? null;
  }

  /**
   * Whether the opening screen is up and a weapon has yet to be chosen.
   *
   * The run is genuinely paused behind it, which means `syncOverlays` would
   * otherwise show the pause screen — the two states are the same to the
   * simulation and different to the player. This flag is what tells them
   * apart. Unlike the briefing it grew out of, it comes back on every restart:
   * the weapon is the decision a run is built around, and somebody who has
   * just watched one fail is exactly the person who wants to make it
   * differently.
   */
  let picking = !unattended;
  if (picking) pauseRun(world);

  // Text first, then the screens built out of it. `relabel` ends by syncing the
  // overlays, so this is also the first sync — and it has to happen here rather
  // than beside the other setup above, because syncing reads `world`.
  relabel();
  mountLanguageSwitch(relabel);

  const loop = new GameLoop(CONFIG.tickRate, CONFIG.maxFrameTime, tick, draw);
  loop.start();

  // Losing the window pauses the run. Deliberately one-way: regaining focus
  // does not resume, or the player is dropped straight back into damage they
  // had no chance to react to.
  //
  // A harness driving the page is the one caller that has to opt out: its tab
  // is never focused or visible, so these two would fire continuously and the
  // run could never advance. `?nopause` is dev-only, so nothing a player runs
  // can take this branch.
  if (!unattended) {
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autoPause();
    });
  }

  // Console handle for poking at a live run: `game.getWorld()` to inspect state,
  // `game.renderer.draw(...)` to force a frame. Dropped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).game = {
      getWorld: () => world,
      renderer,
      loop,
      // Chrome suspends requestAnimationFrame outright in a hidden tab, so a
      // harness cannot wait for the loop to tick. This advances the same fixed
      // steps the loop would have run and draws once, with no rAF involved.
      step: (ticks = 1) => {
        for (let i = 0; i < ticks; i++) tick(1 / CONFIG.tickRate);
        draw(0);
      },
    };
  }

  /**
   * Puts every piece of text on the page into the current language.
   *
   * Three kinds of text need three different things done to them. Static lines
   * are stamped from the markup's own ids; the lines with keycaps in them are
   * rebuilt, because the caps sit in a different place in each language; and
   * everything built from game data — the rules, the opening cards, whichever
   * overlay is up — is re-rendered from its source.
   *
   * The HUD is absent on purpose: it is rewritten on every frame anyway, so it
   * is already in the new language by the time the click that changed it has
   * finished.
   */
  function relabel(): void {
    document.documentElement.lang = getLang();
    applyStaticText();
    renderKeyLines(OFFERS_PER_LEVEL);
    mountHelp(['help-start', 'help-pause', 'help-result']);
    startScreen.relabel();
    // The armed restart button says something the markup does not, so a
    // re-stamp would quietly put the calm label back under a player who had
    // already pressed once.
    pauseScreen.disarm();
    syncOverlays();
  }

  function tick(dt: number): void {
    // Read the phase once. Branching on `world.phase` directly would let the
    // compiler narrow it for the rest of the block, and the systems below
    // change it from underneath that narrowing.
    const phase = world.phase;

    if (phase === 'paused') {
      if (picking) {
        // Only on the panel these keys belong to. The opening screen is a flow
        // now — mode, then a weapon or a team — and Enter inside the waiting
        // room is how a player talks to their team, not how they abandon it for
        // a solo run.
        if (!startScreen.awaitingWeapon()) return;

        // The same digits the level-up screen uses, because it is the same
        // gesture: read three cards, pick one, live with it.
        for (let i = 0; i < starters.length; i++) {
          if (input.consumePressed(`Digit${i + 1}`)) {
            startRun(starters[i].id);
            return;
          }
        }

        // The three keys a player reaches for on a title screen, for somebody
        // who would rather not choose at all. Move keys are deliberately not
        // among them: the first thing a hand does here is settle onto WASD.
        if (
          input.consumePressed('Space') ||
          input.consumePressed('Enter') ||
          input.consumePressed('NumpadEnter')
        ) {
          startRun(starters[0].id);
        }
        return;
      }

      if (pausePressed()) {
        resumeGame();
        return;
      }
      // Same two-step confirmation as the button; the screen shows which press
      // this is.
      if (input.consumePressed('KeyR')) pauseScreen.requestRestart();
      return;
    }

    if ((phase === 'playing' || phase === 'levelup' || phase === 'chest') && pausePressed()) {
      pauseGame();
      return;
    }

    if (phase === 'playing') {
      input.poll();

      // Read before the intent, so a click and a key pressed in the same tick
      // resolve the way they should: the key wins and the order is dropped
      // inside `steeringSystem` rather than half-obeyed here.
      const order = clicks.consume();
      if (order !== null) me().moveTarget = renderer.screenToWorld(order.x, order.y);

      const intent = combinedIntent();
      me().intentX = intent.x;
      me().intentY = intent.y;
      stepWorld(world, dt);
      syncOverlays();
      return;
    }

    if (phase === 'levelup') {
      const offers = chooser()?.offered ?? [];
      for (let i = 0; i < offers.length; i++) {
        if (input.consumePressed(`Digit${i + 1}`)) {
          pickUpgrade(offers[i].id);
          return;
        }
      }
      return;
    }

    // Same digits as the level-up screen, because it is the same gesture on
    // the same cards. The two never overlap: a level gained on the tick a
    // chest opened waits in `pendingLevels` until the chest is spent.
    if (phase === 'chest') {
      for (let i = 0; i < world.spoils.length; i++) {
        if (input.consumePressed(`Digit${i + 1}`)) {
          pickSpoil(world.spoils[i].id);
          return;
        }
      }
      return;
    }

    if (phase === 'dead') {
      if (input.consumePressed('KeyR')) restart();
    }
  }

  function pausePressed(): boolean {
    return input.consumePressed('Escape') || input.consumePressed('KeyP');
  }

  /**
   * Keys and thumb, summed and clamped.
   *
   * Summing rather than picking a winner means neither input has to know the
   * other exists, and a phone with a keyboard attached behaves the way both
   * halves promise. The clamp is what stops holding both from moving faster
   * than either — the simulation multiplies this straight into `moveSpeed`.
   */
  function combinedIntent(): { x: number; y: number } {
    const x = input.x + touch.x;
    const y = input.y + touch.y;
    const length = Math.hypot(x, y);
    if (length <= 1) return { x, y };
    return { x: x / length, y: y / length };
  }

  function togglePause(): void {
    // The opening screen is paused too, and this button would lift that pause
    // while leaving the panel up — a run advancing behind a screen that says
    // it has not started. Choosing a weapon is the only way out of it.
    if (picking) return;

    if (world.phase === 'paused') {
      resumeGame();
      return;
    }
    if (canPause(world)) pauseGame();
  }

  function pauseGame(): void {
    pauseRun(world);
    // Otherwise the key that paused is still queued and unpauses immediately.
    input.clearPressed();
    // A finger that was steering when the phone rang is not steering any more,
    // and the world must not resume still holding its last direction.
    touch.reset();
    clicks.reset();
    syncOverlays();
  }

  /**
   * Opens a run with `weaponId`.
   *
   * Builds a new world rather than arming the paused one behind the screen:
   * the starting weapon decides both what the player is granted and which
   * figure they are, and the constructor is where those are settled. The seed
   * is re-read with it, so choosing a weapon on a `?seed` link replays that
   * seed with this weapon rather than silently ignoring one of the two.
   */
  function startRun(weaponId: string): void {
    picking = false;
    world = newWorld(weaponId);
    // Everything an unpause clears, for the same reason: the key or the click
    // that chose the weapon must not also be read by the run it starts.
    input.clearPressed();
    touch.reset();
    clicks.reset();
    loop.resync();
    syncOverlays();
  }

  function resumeGame(): void {
    resumeRun(world);
    input.clearPressed();
    // A click aimed at a screen that was covering the game is not a move order.
    clicks.reset();
    loop.resync();
    syncOverlays();
  }

  function autoPause(): void {
    if (!canPause(world)) return;
    pauseGame();
  }

  function draw(alpha: number): void {
    renderer.draw(world, me(), alpha);
    hud.update(world, me());
    stick.update(touch);
  }

  function pickUpgrade(id: string): void {
    const player = chooser();
    if (player === null) return;

    applyUpgrade(world, player, id);
    // Otherwise a still-held number key would immediately eat the next offer.
    input.clearPressed();
    // Only the click: a right button still down goes on steering, which is the
    // whole point of holding it.
    clicks.clearPending();
    syncOverlays();
  }

  /**
   * Same handling as an upgrade, for the same two reasons.
   *
   * A chest can be followed immediately by a level-up screen — a sweep kills
   * the whole field and every body drops its gem — so the held digit that
   * spent the spoil must not also take the first card of the menu behind it.
   */
  function pickSpoil(id: string): void {
    const player = chooser();
    if (player === null) return;

    takeSpoil(world, player, id);
    input.clearPressed();
    clicks.clearPending();
    syncOverlays();
  }

  /** Single source of truth for which overlay is visible. */
  function syncOverlays(): void {
    if (world.phase === 'paused' && picking) {
      startScreen.show();
    } else {
      startScreen.hide();
    }

    if (world.phase === 'paused' && !picking) {
      pauseScreen.show();
    } else {
      pauseScreen.hide();
    }

    const picker = chooser();
    if (world.phase === 'levelup' && picker !== null) {
      upgradeMenu.show(picker.offered, picker.stacks);
    } else {
      upgradeMenu.hide();
    }

    if (world.phase === 'chest') {
      chestMenu.show(world.spoils);
    } else {
      chestMenu.hide();
    }

    if (world.phase === 'dead') {
      resultScreen.show(world);
    } else {
      resultScreen.hide();
    }
  }

  /**
   * Throws the run away and asks for a weapon again.
   *
   * Back to the choice rather than straight into another run with the same
   * one. A harness has nobody to ask, so it restarts into the default and
   * keeps going.
   */
  function restart(): void {
    if (unattended) {
      startRun(STARTER_WEAPON_ID);
      return;
    }

    picking = true;
    world = newWorld();
    pauseRun(world);
    input.clearPressed();
    touch.reset();
    clicks.reset();
    // A fresh run should not inherit whatever the accumulator was holding.
    loop.resync();
    syncOverlays();
  }
}

/**
 * `?seed=123` replays an exact run — the whole simulation is deterministic for
 * a given seed, which makes a bug report reproducible instead of anecdotal.
 */
function newWorld(starterId?: string): World {
  const requested = new URLSearchParams(window.location.search).get('seed');
  const parsed = requested === null ? Number.NaN : Number.parseInt(requested, 10);
  return new World(Number.isFinite(parsed) ? parsed : Date.now() >>> 0, starterId);
}

void main();
