import { beforeEach, describe, expect, it } from 'vitest';
import { Input } from '../src/core/input';
import { pauseRun, resumeRun } from '../src/world/pause';
import { World } from '../src/world/world';

/**
 * `Input` talks to `window`, which Node does not have. An `EventTarget` is
 * enough: the class only ever adds listeners and reads `code` and `repeat` off
 * the event.
 */
const fakeWindow = new EventTarget();

beforeEach(() => {
  (globalThis as unknown as { window: EventTarget }).window = fakeWindow;
});

function press(code: string, repeat = false): void {
  const event = new Event('keydown') as Event & { code: string; repeat: boolean };
  event.code = code;
  event.repeat = repeat;
  fakeWindow.dispatchEvent(event);
}

function release(code: string): void {
  const event = new Event('keyup') as Event & { code: string };
  event.code = code;
  fakeWindow.dispatchEvent(event);
}

describe('Input.consumePressed', () => {
  it('reports every fresh press, not just the first one', () => {
    const input = new Input();
    input.attach();

    for (let i = 0; i < 5; i++) {
      press('Escape');
      expect(input.consumePressed('Escape')).toBe(true);
      // A second read of the same press must not fire again.
      expect(input.consumePressed('Escape')).toBe(false);
      release('Escape');
    }

    input.detach();
  });

  it('survives clearPressed between presses', () => {
    const input = new Input();
    input.attach();

    press('KeyP');
    expect(input.consumePressed('KeyP')).toBe(true);
    input.clearPressed();

    press('KeyP');
    expect(input.consumePressed('KeyP')).toBe(true);

    input.detach();
  });

  it('ignores auto-repeat while a key is held down', () => {
    const input = new Input();
    input.attach();

    press('Escape');
    press('Escape', true);
    press('Escape', true);

    expect(input.consumePressed('Escape')).toBe(true);
    expect(input.consumePressed('Escape')).toBe(false);

    input.detach();
  });
});

/**
 * The exact sequence a player performs: tap, tap, tap. Reproduces the routing
 * from main.ts so a regression there has something to fail against.
 */
describe('pause toggling through real key events', () => {
  it('toggles on every press, not only the first', () => {
    const input = new Input();
    input.attach();
    const world = new World(1);

    const pausePressed = (): boolean =>
      input.consumePressed('Escape') || input.consumePressed('KeyP');

    const seen: string[] = [world.phase];

    for (const code of ['Escape', 'KeyP', 'Escape', 'KeyP', 'Escape']) {
      press(code);
      release(code);

      if (world.phase === 'paused') {
        if (pausePressed()) {
          resumeRun(world);
          input.clearPressed();
        }
      } else if (pausePressed()) {
        pauseRun(world);
        input.clearPressed();
      }

      seen.push(world.phase);
    }

    expect(seen).toEqual([
      'playing',
      'paused',
      'playing',
      'paused',
      'playing',
      'paused',
    ]);

    input.detach();
  });
});
