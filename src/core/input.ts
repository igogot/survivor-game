const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];

/** Keys the browser would otherwise scroll the page with. */
const SWALLOW = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN, 'Space']);

/**
 * Keyboard state, sampled once per tick rather than read from event handlers.
 * Events fire at arbitrary times; the simulation must see a single consistent
 * intent for the whole tick.
 */
export class Input {
  /** Normalized move direction, refreshed by `poll()`. */
  x = 0;
  y = 0;

  private readonly held = new Set<string>();
  private readonly pressedSinceLastRead = new Set<string>();

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  poll(): void {
    let x = 0;
    let y = 0;
    if (this.anyHeld(LEFT)) x -= 1;
    if (this.anyHeld(RIGHT)) x += 1;
    if (this.anyHeld(UP)) y -= 1;
    if (this.anyHeld(DOWN)) y += 1;

    // Without normalizing, diagonal movement would be ~41% faster.
    const length = Math.hypot(x, y);
    if (length > 0) {
      x /= length;
      y /= length;
    }

    this.x = x;
    this.y = y;
  }

  /** One-shot read for menus: true once per physical key press. */
  consumePressed(code: string): boolean {
    if (!this.pressedSinceLastRead.has(code)) return false;
    this.pressedSinceLastRead.delete(code);
    return true;
  }

  clearPressed(): void {
    this.pressedSinceLastRead.clear();
  }

  private anyHeld(codes: readonly string[]): boolean {
    for (const code of codes) {
      if (this.held.has(code)) return true;
    }
    return false;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) this.pressedSinceLastRead.add(event.code);
    this.held.add(event.code);
    if (SWALLOW.has(event.code)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  /** Alt-tabbing away otherwise leaves keys stuck down. */
  private onBlur = (): void => {
    this.held.clear();
    this.pressedSinceLastRead.clear();
    this.x = 0;
    this.y = 0;
  };
}
