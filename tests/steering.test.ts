import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ClickInput } from '../src/core/click-input';
import { approach, viewToWorld } from '../src/core/steering';
import { movementSystem, steeringSystem } from '../src/systems/movement';
import { World } from '../src/world/world';

const DT = 1 / CONFIG.tickRate;

/**
 * One tick of the loop, as `main.ts` runs it: the intent is rebuilt from the
 * hands every tick, and a standing order only fills it if the hands left it
 * empty.
 */
function walk(world: World, keyX = 0, keyY = 0): void {
  world.intentX = keyX;
  world.intentY = keyY;
  steeringSystem(world, DT);
  movementSystem(world, DT);
}

describe('approach', () => {
  it('heads for the destination at full speed while it is far away', () => {
    const walkStep = approach(0, 0, 30, 40, 5);

    expect(walkStep.arrived).toBe(false);
    expect(walkStep.x).toBeCloseTo(0.6);
    expect(walkStep.y).toBeCloseTo(0.8);
    expect(Math.hypot(walkStep.x, walkStep.y)).toBeCloseTo(1);
  });

  it('scales the last step down so it lands on the point instead of past it', () => {
    // A quarter of a step away: at full strength this would overshoot by three
    // quarters and spend the next tick walking back.
    const walkStep = approach(0, 0, 2.5, 0, 10);

    expect(walkStep.arrived).toBe(true);
    expect(walkStep.x).toBeCloseTo(0.25);
    expect(walkStep.y).toBeCloseTo(0);
  });

  it('reports arrival rather than dividing by nothing when the player cannot move', () => {
    const walkStep = approach(0, 0, 100, 0, 0);

    expect(walkStep).toEqual({ x: 0, y: 0, arrived: true });
  });
});

/**
 * The camera as `GameRenderer.draw` builds it: centred on the player, scaled by
 * the zoom. Written out here rather than imported so the test would still fail
 * if the renderer changed how it places the camera.
 */
function camera(playerX: number, playerY: number, width: number, height: number, zoom: number) {
  return { x: width / 2 - playerX * zoom, y: height / 2 - playerY * zoom };
}

describe('viewToWorld', () => {
  it('reads the middle of the screen as the player, wherever they are', () => {
    const view = camera(4200, -900, 1600, 900, 1);

    expect(viewToWorld(800, 450, view.x, view.y, 1)).toEqual({ x: 4200, y: -900 });
  });

  it('measures from the player outwards, in world units', () => {
    const view = camera(0, 0, 1600, 900, 1);

    // 100 pixels right and 50 up of centre, on an unzoomed camera.
    expect(viewToWorld(900, 400, view.x, view.y, 1)).toEqual({ x: 100, y: -50 });
  });

  it('divides the distance out by the zoom', () => {
    const zoom = 2;
    const view = camera(0, 0, 1600, 900, zoom);

    // The same 100 pixels are half as much ground when the camera is twice in.
    expect(viewToWorld(900, 450, view.x, view.y, zoom)).toEqual({ x: 50, y: 0 });
  });
});

describe('steeringSystem', () => {
  it('walks to the ordered point, lands on it exactly and drops the order', () => {
    const world = new World(1);
    world.moveTarget = { x: 200, y: -150 };

    // Long enough to cover the distance several times over; the order must be
    // spent well before the loop runs out.
    for (let i = 0; i < 200; i++) {
      if (world.moveTarget === null) break;
      walk(world);
    }

    expect(world.moveTarget).toBeNull();
    expect(world.player.x).toBeCloseTo(200);
    expect(world.player.y).toBeCloseTo(-150);
  });

  it('stays put once it has arrived instead of vibrating on the spot', () => {
    const world = new World(1);
    world.moveTarget = { x: 40, y: 0 };

    for (let i = 0; i < 60; i++) walk(world);
    const settled = { x: world.player.x, y: world.player.y };

    for (let i = 0; i < 60; i++) walk(world);

    expect(world.player.x).toBe(settled.x);
    expect(world.player.y).toBe(settled.y);
    expect(world.intentX).toBe(0);
    expect(world.intentY).toBe(0);
  });

  it('gives the keyboard the wheel back and throws the order away', () => {
    const world = new World(1);
    world.moveTarget = { x: 0, y: 500 };

    walk(world);
    expect(world.moveTarget).not.toBeNull();

    // A hand back on the keys, pushing the other way.
    walk(world, -1, 0);

    expect(world.moveTarget).toBeNull();
    expect(world.player.x).toBeLessThan(0);
  });

  it('leaves a world nobody ordered anywhere completely alone', () => {
    const world = new World(1);

    walk(world, 1, 0);

    expect(world.moveTarget).toBeNull();
    expect(world.player.x).toBeCloseTo(CONFIG.player.moveSpeed * DT);
    expect(world.player.y).toBe(0);
  });
});

/**
 * `ClickInput` reads three properties off a pointer event and nothing else, so
 * an `EventTarget` and a plain `Event` are enough to drive it in Node.
 */
describe('ClickInput', () => {
  const surface = new EventTarget();
  let clicks: ClickInput;

  beforeEach(() => {
    clicks = new ClickInput();
    clicks.attach(surface);
  });

  function pointerDown(button: number, x: number, y: number): void {
    const event = new Event('pointerdown') as Event & {
      button: number;
      clientX: number;
      clientY: number;
    };
    event.button = button;
    event.clientX = x;
    event.clientY = y;
    surface.dispatchEvent(event);
  }

  it('records a right-click and hands it over exactly once', () => {
    pointerDown(2, 120, 340);

    expect(clicks.consume()).toEqual({ x: 120, y: 340 });
    expect(clicks.consume()).toBeNull();

    clicks.detach();
  });

  it('ignores the left button, which belongs to the stick', () => {
    pointerDown(0, 10, 10);

    expect(clicks.consume()).toBeNull();

    clicks.detach();
  });

  it('keeps only the last order when two arrive inside one tick', () => {
    pointerDown(2, 1, 1);
    pointerDown(2, 2, 2);

    expect(clicks.consume()).toEqual({ x: 2, y: 2 });

    clicks.detach();
  });

  it('drops an unread order on reset', () => {
    pointerDown(2, 5, 5);
    clicks.reset();

    expect(clicks.consume()).toBeNull();

    clicks.detach();
  });

  it('suppresses the browser menu over the canvas', () => {
    const event = new Event('contextmenu', { cancelable: true });
    surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);

    clicks.detach();
  });

  it('stops listening once detached', () => {
    clicks.detach();
    pointerDown(2, 9, 9);

    expect(clicks.consume()).toBeNull();
  });
});
