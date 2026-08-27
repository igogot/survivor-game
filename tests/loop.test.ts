import { afterEach, describe, expect, it } from 'vitest';
import { GameLoop } from '../src/core/loop';

/**
 * Drives `GameLoop` by hand.
 *
 * `requestAnimationFrame` does not exist in Node, which is convenient: stubbing
 * it turns the loop into a step function and makes frame timing exact instead
 * of whatever the machine happened to do.
 */
function harness() {
  const pending: FrameRequestCallback[] = [];
  const globals = globalThis as unknown as {
    requestAnimationFrame: unknown;
    cancelAnimationFrame: unknown;
  };

  globals.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    pending.push(callback);
    return pending.length;
  };
  globals.cancelAnimationFrame = (): void => {
    pending.length = 0;
  };

  return {
    /** Runs exactly one frame at the given timestamp. */
    frame(now: number): void {
      const next = pending.shift();
      if (next === undefined) throw new Error('no frame was requested');
      next(now);
    },
  };
}

afterEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.requestAnimationFrame;
  delete globals.cancelAnimationFrame;
});

describe('GameLoop', () => {
  it('advances the simulation in fixed steps', () => {
    const driver = harness();
    const steps: number[] = [];

    const loop = new GameLoop(60, 0.25, (dt) => steps.push(dt), () => {});
    loop.start();

    const base = performance.now();
    driver.frame(base + 100);

    expect(steps.length).toBe(6);
    for (const dt of steps) expect(dt).toBeCloseTo(1 / 60);

    loop.stop();
  });

  it('clamps a long stall instead of queueing catch-up ticks', () => {
    const driver = harness();
    let ticks = 0;

    const loop = new GameLoop(60, 0.25, () => ticks++, () => {});
    loop.start();

    const base = performance.now();
    // Ten seconds away; without the clamp this would be 600 ticks in one frame.
    driver.frame(base + 10_000);

    expect(ticks).toBeLessThanOrEqual(Math.ceil(0.25 * 60));

    loop.stop();
  });

  /**
   * `resync` is called from inside `update`, which runs inside the catch-up
   * loop. Applying it there used to leave the accumulator negative and hand the
   * renderer alpha = -1, drawing every entity a tick behind for one frame.
   */
  it('never renders a negative alpha after a resync', () => {
    const driver = harness();
    const alphas: number[] = [];
    let tick = 0;

    const loop: GameLoop = new GameLoop(
      60,
      0.25,
      () => {
        tick++;
        if (tick === 3) loop.resync();
      },
      (alpha) => alphas.push(alpha),
    );
    loop.start();

    const base = performance.now();
    for (let frame = 1; frame <= 12; frame++) {
      driver.frame(base + frame * 16.7);
    }

    expect(alphas.length).toBe(12);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }

    loop.stop();
  });
});
