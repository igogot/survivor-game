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
  private resyncRequested = false;

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

  /**
   * Drops time the loop has taken in but not yet simulated.
   *
   * `maxFrameTime` already stops one long stall from queueing catch-up ticks,
   * but coming back from a pause should not spend even a fraction of a tick on
   * time the player was not playing.
   *
   * Deferred rather than applied here, because the only caller is `update`,
   * which runs *inside* the catch-up loop below. Zeroing the accumulator on the
   * spot would leave that loop to subtract a step from it immediately, and the
   * renderer would be handed a negative `alpha` — drawing every entity a whole
   * tick behind where it actually was, for one visible frame.
   */
  resync(): void {
    this.resyncRequested = true;
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

      if (this.resyncRequested) {
        this.resyncRequested = false;
        this.accumulator = 0;
        this.lastTime = performance.now();
        break;
      }

      this.accumulator -= this.step;
    }

    this.render(this.accumulator / this.step);
  };
}
