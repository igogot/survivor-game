import { CONFIG } from './config';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GameRenderer } from './render/renderer';
import { applyUpgrade } from './systems/progression';
import { Hud } from './ui/hud';
import { PauseScreen, ResultScreen, UpgradeMenu } from './ui/menus';
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

  const hud = new Hud();
  const resultScreen = new ResultScreen();
  const pauseScreen = new PauseScreen();
  const upgradeMenu = new UpgradeMenu(pickUpgrade);

  // Reassigned on restart, so every closure below reads the binding rather than
  // capturing one instance.
  let world = newWorld();

  const loop = new GameLoop(CONFIG.tickRate, CONFIG.maxFrameTime, tick, draw);
  loop.start();

  // Losing the window pauses the run. Deliberately one-way: regaining focus
  // does not resume, or the player is dropped straight back into damage they
  // had no chance to react to.
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autoPause();
  });

  // Console handle for poking at a live run: `game.getWorld()` to inspect state,
  // `game.renderer.draw(...)` to force a frame. Dropped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).game = {
      getWorld: () => world,
      renderer,
      loop,
    };
  }

  function tick(dt: number): void {
    // Read the phase once. Branching on `world.phase` directly would let the
    // compiler narrow it for the rest of the block, and the systems below
    // change it from underneath that narrowing.
    const phase = world.phase;

    if (phase === 'paused') {
      if (pausePressed()) resumeGame();
      return;
    }

    if ((phase === 'playing' || phase === 'levelup') && pausePressed()) {
      pauseGame();
      return;
    }

    if (phase === 'playing') {
      input.poll();
      world.intentX = input.x;
      world.intentY = input.y;
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

  function pauseGame(): void {
    pauseRun(world);
    // Otherwise the key that paused is still queued and unpauses immediately.
    input.clearPressed();
    syncOverlays();
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
  }

  function pickUpgrade(id: string): void {
    applyUpgrade(world, id);
    // Otherwise a still-held number key would immediately eat the next offer.
    input.clearPressed();
    syncOverlays();
  }

  /** Single source of truth for which overlay is visible. */
  function syncOverlays(): void {
    if (world.phase === 'paused') {
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
