/**
 * Fixed-timestep game loop with render interpolation.
 *
 * The simulation always advances in equal slices, so physics and balance behave
 * identically at 60 Hz and 144 Hz, and a headless test can step the exact same
 * world without a browser. Leftover time in the accumulator is handed to the
 * renderer as `alpha` so entities are drawn between their previous and current
 * tick positions instead of stuttering.
 *
 * Reference: Glenn Fiedler, "Fix Your Timestep!".
 */
export class GameLoop {
  private readonly step: number;
  private accumulator = 0;
  private lastTime = 0;
  private frameHandle = 0;
  private running = false;

  constructor(
    tickRate: number,
    private readonly maxFrameTime: number,
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {
    this.step = 1 / tickRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  private onFrame = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);

    let elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // A long stall (tab in the background, breakpoint hit) must not queue
    // hundreds of catch-up ticks, which would stall the next frame even harder.
    if (elapsed > this.maxFrameTime) elapsed = this.maxFrameTime;

    this.accumulator += elapsed;
    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }

    this.render(this.accumulator / this.step);
  };
}
