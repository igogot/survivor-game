import type { Vector } from './touch';

/** `PointerEvent.button` for the right mouse button. */
const SECONDARY_BUTTON = 2;

/**
 * Right-click move orders, sampled once per tick like the keyboard.
 *
 * Only the most recent click survives to be read. Two clicks inside one tick
 * are a player who changed their mind sixteen milliseconds apart, and the
 * second one is the one they meant.
 *
 * Coordinates stay in client pixels. This class has no idea where the camera
 * is; turning a pixel on screen into a place in the world is the renderer's
 * job, because only the renderer knows which frame the player was aiming at.
 */
export class ClickInput {
  private surface: EventTarget | null = null;
  private pending: Vector | null = null;

  attach(surface: EventTarget): void {
    this.detach();
    this.surface = surface;
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    const surface = this.surface;
    if (surface === null) return;

    surface.removeEventListener('pointerdown', this.onPointerDown);
    surface.removeEventListener('contextmenu', this.onContextMenu);
    this.surface = null;
    this.reset();
  }

  /** Reads the queued order and clears it. Null when there was none. */
  consume(): Vector | null {
    const order = this.pending;
    this.pending = null;
    return order;
  }

  /**
   * Drops an unread order — used when a run pauses, like the stick.
   *
   * Without it a click made while the level-up screen was up would be obeyed
   * the instant the run resumed, sending the player somewhere they aimed at a
   * card, not at the ground.
   */
  reset(): void {
    this.pending = null;
  }

  private onPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.button !== SECONDARY_BUTTON) return;
    this.pending = { x: pointer.clientX, y: pointer.clientY };
  };

  /**
   * The browser menu would open over the game on every order given, and its
   * first click would be spent closing it again.
   *
   * Suppressed on the canvas alone: a right-click on the page around it still
   * behaves like a web page.
   */
  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
