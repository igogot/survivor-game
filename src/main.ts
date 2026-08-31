import { CONFIG } from './config';
import { GameLoop } from './core/loop';
import { autoPauseDisabled } from './dev/flags';
import { Input } from './core/input';
import { TouchInput } from './core/touch-input';
import { GameRenderer } from './render/renderer';
import { applyUpgrade } from './systems/progression';
import { Hud } from './ui/hud';
import { PauseScreen, ResultScreen, StartScreen, UpgradeMenu, mountHelp } from './ui/menus';
import { StickView } from './ui/stick';
import { canPause, pauseRun, resumeRun } from './world/pause';
import { stepWorld } from './world/step';
import { World } from './world/world';

async function main(): Promise<void> {
  const host = document.getElementById('app');
  if (host === null) throw new Error('Missing #app in index.html');

  const renderer = new GameRenderer();
  await renderer.init(host);

  const input = new Input();
  input.attach();

  // The canvas, not the window: the HUD is `pointer-events: none` and passes
  // touches through, but the buttons and cards layered over it are not, so a
  // tap meant for a card never also starts the stick under it.
  const touch = new TouchInput();
  touch.attach(host);

  const hud = new Hud();
  const stick = new StickView();
  const resultScreen = new ResultScreen(restart);
  const pauseScreen = new PauseScreen(resumeGame, restart);
  const upgradeMenu = new UpgradeMenu(pickUpgrade);
  const startScreen = new StartScreen(beginRun);

  // One source of rules, printed into the briefing, the pause screen and the
  // result screen. Rendered once at boot: the text never changes within a
  // session, and rebuilding it on every pause would be work for nothing.
  mountHelp(['help-start', 'help-pause', 'help-result']);

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
   * Whether the briefing is still up.
   *
   * The run is genuinely paused behind it, which means `syncOverlays` would
   * otherwise show the pause screen — the two states are the same to the
   * simulation and different to the player. This flag is what tells them apart,
   * and it is cleared for good on the first start: someone who has already read
   * the rules and pressed Restart wants the next run, not the briefing again.
   */
  let briefing = !unattended;
  if (briefing) pauseRun(world);
  syncOverlays();

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

  function tick(dt: number): void {
    // Read the phase once. Branching on `world.phase` directly would let the
    // compiler narrow it for the rest of the block, and the systems below
    // change it from underneath that narrowing.
    const phase = world.phase;

    if (phase === 'paused') {
      if (briefing) {
        // Any of the three keys a player reaches for on a title screen. Move
        // keys are deliberately not among them: the first thing a hand does
        // here is settle onto WASD.
        if (
          input.consumePressed('Space') ||
          input.consumePressed('Enter') ||
          input.consumePressed('NumpadEnter')
        ) {
          beginRun();
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

    if ((phase === 'playing' || phase === 'levelup') && pausePressed()) {
      pauseGame();
      return;
    }

    if (phase === 'playing') {
      input.poll();
      const intent = combinedIntent();
      world.intentX = intent.x;
      world.intentY = intent.y;
      stepWorld(world, dt);
      syncOverlays();
      return;
    }

    if (phase === 'levelup') {
      for (let i = 0; i < world.offered.length; i++) {
        if (input.consumePressed(`Digit${i + 1}`)) {
          pickUpgrade(world.offered[i].id);
          return;
        }
      }
      return;
    }

    if (phase === 'dead' || phase === 'won') {
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
    // The briefing is paused too, and this button would lift that pause while
    // leaving the panel up — a run advancing behind a screen that says it has
    // not started. Its own button is the only way out of it.
    if (briefing) return;

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
    syncOverlays();
  }

  /**
   * Leaves the briefing for the first time.
   *
   * Goes through `resumeGame` rather than setting the phase itself, so the
   * accumulator resync and the pressed-key clear that every other unpause
   * performs happen here too — the key that dismissed this screen must not also
   * be read by the run it starts.
   */
  function beginRun(): void {
    if (!briefing) return;
    briefing = false;
    resumeGame();
  }

  function resumeGame(): void {
    resumeRun(world);
    input.clearPressed();
    loop.resync();
    syncOverlays();
  }

  function autoPause(): void {
    if (!canPause(world)) return;
    pauseGame();
  }

  function draw(alpha: number): void {
    renderer.draw(world, alpha);
    hud.update(world);
    stick.update(touch);
  }

  function pickUpgrade(id: string): void {
    applyUpgrade(world, id);
    // Otherwise a still-held number key would immediately eat the next offer.
    input.clearPressed();
    syncOverlays();
  }

  /** Single source of truth for which overlay is visible. */
  function syncOverlays(): void {
    if (world.phase === 'paused' && briefing) {
      startScreen.show();
    } else {
      startScreen.hide();
    }

    if (world.phase === 'paused' && !briefing) {
      pauseScreen.show();
    } else {
      pauseScreen.hide();
    }

    if (world.phase === 'levelup') {
      upgradeMenu.show(world.offered, world.stacks);
    } else {
      upgradeMenu.hide();
    }

    if (world.phase === 'dead' || world.phase === 'won') {
      resultScreen.show(world);
    } else {
      resultScreen.hide();
    }
  }

  function restart(): void {
    world = newWorld();
    input.clearPressed();
    touch.reset();
    // A fresh run should not inherit whatever the accumulator was holding.
    loop.resync();
    syncOverlays();
  }
}

/**
 * `?seed=123` replays an exact run — the whole simulation is deterministic for
 * a given seed, which makes a bug report reproducible instead of anecdotal.
 */
function newWorld(): World {
  const requested = new URLSearchParams(window.location.search).get('seed');
  const parsed = requested === null ? Number.NaN : Number.parseInt(requested, 10);
  return new World(Number.isFinite(parsed) ? parsed : Date.now() >>> 0);
}

void main();
