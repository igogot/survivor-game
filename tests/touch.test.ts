import { beforeEach, describe, expect, it } from 'vitest';
import { STICK_DEAD_ZONE, STICK_RADIUS, stickIntent, stickKnob } from '../src/core/touch';
import { TouchInput } from '../src/core/touch-input';

/**
 * The stick is DOM-free for the same reason the simulation is: what it does is
 * arithmetic, and arithmetic can be checked without a phone in hand. An
 * `EventTarget` is all `TouchInput` needs — it only adds listeners and reads
 * `pointerId`, `button` and the client coordinates off the event.
 */
const surface = new EventTarget();
let touch: TouchInput;

beforeEach(() => {
  touch?.detach();
  touch = new TouchInput();
  touch.attach(surface);
});

function pointer(type: string, x: number, y: number, id = 1, button = 0): void {
  const event = new Event(type) as Event & {
    pointerId: number;
    button: number;
    clientX: number;
    clientY: number;
  };
  event.pointerId = id;
  // A finger and a pen both report the primary button; only a mouse reports
  // anything else, and the stick is not what a right-click is for.
  event.button = button;
  event.clientX = x;
  event.clientY = y;
  surface.dispatchEvent(event);
}

describe('stickIntent', () => {
  it('ignores a finger that has barely moved', () => {
    expect(stickIntent(0, 0)).toEqual({ x: 0, y: 0 });
    expect(stickIntent(STICK_DEAD_ZONE, 0)).toEqual({ x: 0, y: 0 });
  });

  it('reaches full speed at the ring and never passes it', () => {
    expect(magnitude(stickIntent(STICK_RADIUS, 0))).toBeCloseTo(1);
    expect(magnitude(stickIntent(STICK_RADIUS * 10, 0))).toBeCloseTo(1);
    expect(magnitude(stickIntent(400, 400))).toBeCloseTo(1);
  });

  it('is analog between the two', () => {
    const near = magnitude(stickIntent(STICK_DEAD_ZONE + 4, 0));
    const far = magnitude(stickIntent(STICK_RADIUS - 4, 0));

    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(far);
    expect(far).toBeLessThan(1);
  });

  it('points where the finger points, whatever the distance', () => {
    const short = stickIntent(30, -30);
    const long = stickIntent(300, -300);

    expect(short.x).toBeCloseTo(-short.y);
    expect(long.x).toBeCloseTo(-long.y);
    expect(Math.atan2(short.y, short.x)).toBeCloseTo(Math.atan2(long.y, long.x));
  });
});

describe('stickKnob', () => {
  it('sits under the finger inside the ring', () => {
    expect(stickKnob(10, -20)).toEqual({ x: 10, y: -20 });
  });

  it('stops at the ring outside it, without turning', () => {
    const knob = stickKnob(300, 400);

    expect(magnitude(knob)).toBeCloseTo(STICK_RADIUS);
    expect(Math.atan2(knob.y, knob.x)).toBeCloseTo(Math.atan2(400, 300));
  });
});

describe('TouchInput', () => {
  it('steers from wherever the finger landed, not from a fixed spot', () => {
    pointer('pointerdown', 700, 500);
    pointer('pointermove', 700 + STICK_RADIUS, 500);

    expect(touch.active).toBe(true);
    expect(touch.origin).toEqual({ x: 700, y: 500 });
    expect(touch.x).toBeCloseTo(1);
    expect(touch.y).toBeCloseTo(0);
  });

  it('reports nothing until the finger actually moves', () => {
    pointer('pointerdown', 100, 100);

    expect(touch.x).toBe(0);
    expect(touch.y).toBe(0);
  });

  it('lets a second finger through instead of stealing the stick', () => {
    pointer('pointerdown', 100, 100, 1);
    pointer('pointermove', 100, 100 + STICK_RADIUS, 1);

    pointer('pointerdown', 600, 300, 2);
    pointer('pointermove', 600 + STICK_RADIUS, 300, 2);

    expect(touch.origin).toEqual({ x: 100, y: 100 });
    expect(touch.y).toBeCloseTo(1);
    expect(touch.x).toBeCloseTo(0);
  });

  /** The right button orders a walk; grabbing the stick too would fight it. */
  it('leaves the right mouse button alone', () => {
    pointer('pointerdown', 100, 100, 1, 2);
    pointer('pointermove', 100 + STICK_RADIUS, 100, 1);

    expect(touch.active).toBe(false);
    expect(touch.x).toBe(0);
    expect(touch.y).toBe(0);
  });

  it('keeps steering when the other finger lifts', () => {
    pointer('pointerdown', 100, 100, 1);
    pointer('pointermove', 100 + STICK_RADIUS, 100, 1);
    pointer('pointerup', 600, 300, 2);

    expect(touch.active).toBe(true);
    expect(touch.x).toBeCloseTo(1);
  });

  it('stops dead when the finger lifts', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100 + STICK_RADIUS, 100);
    pointer('pointerup', 100 + STICK_RADIUS, 100);

    expect(touch.active).toBe(false);
    expect(touch.x).toBe(0);
    expect(touch.y).toBe(0);
  });

  /** A call, a notification tray, a palm: the browser takes the pointer away. */
  it('stops dead when the system cancels the touch', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 100 + STICK_RADIUS);
    pointer('pointercancel', 100, 100 + STICK_RADIUS);

    expect(touch.active).toBe(false);
    expect(touch.y).toBe(0);
  });

  it('drops the stick on demand, for a run that pauses mid-drag', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100 + STICK_RADIUS, 100);

    touch.reset();

    expect(touch.active).toBe(false);
    expect(touch.x).toBe(0);
  });

  it('goes quiet after detach', () => {
    touch.detach();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100 + STICK_RADIUS, 100);

    expect(touch.active).toBe(false);
    expect(touch.x).toBe(0);
  });
});

function magnitude(vector: { x: number; y: number }): number {
  return Math.hypot(vector.x, vector.y);
}
