import type { Vector } from './touch';

/** `PointerEvent.button` for the right mouse button. */
const SECONDARY_BUTTON = 2;

/**
 * Right-click move orders, sampled once per tick like the keyboard.
 *
 * A click is one order: the last position wins, because two clicks inside one
 * tick are a player who changed their mind sixteen milliseconds apart. Holding
 * the button is a standing one instead — the order is reissued every tick from
 * wherever the cursor is, and the player follows it until the button comes up.
 *
 * Coordinates stay in client pixels. This class has no idea where the camera
 * is; turning a pixel on screen into a place in the world is the renderer's
 * job, because only the renderer knows which frame the player was aiming at.
 */
export class ClickInput {
  private surface: EventTarget | null = null;
  private pending: Vector | null = null;

  /** The pointer whose button is down, or null while none is. */
  private heldPointer: number | null = null;
  private cursorX = 0;
  private cursorY = 0;

  attach(surface: EventTarget): void {
    this.detach();
    this.surface = surface;
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerEnd);
    surface.addEventListener('pointercancel', this.onPointerEnd);
    surface.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    const surface = this.surface;
    if (surface === null) return;

    surface.removeEventListener('pointerdown', this.onPointerDown);
    surface.removeEventListener('pointermove', this.onPointerMove);
    surface.removeEventListener('pointerup', this.onPointerEnd);
    surface.removeEventListener('pointercancel', this.onPointerEnd);
    surface.removeEventListener('contextmenu', this.onContextMenu);
    this.surface = null;
    this.reset();
  }

  /**
   * The point to walk to this tick, or null when nothing has been ordered.
   *
   * A held button answers with wherever the cursor is now, every tick, and
   * that is the whole of the drag-to-move behaviour: the camera rides the
   * player, so a mouse lying perfectly still still names fresh ground every
   * tick and the player keeps walking toward it. A click that has already been
   * released is handed over once and then forgotten.
   */
  consume(): Vector | null {
    if (this.heldPointer !== null) return { x: this.cursorX, y: this.cursorY };

    const order = this.pending;
    this.pending = null;
    return order;
  }

  /**
   * Drops an unread click, leaving a held button in charge.
   *
   * What the level-up screen needs. Without it a click made while the cards
   * were up would be obeyed the instant they closed, sending the player
   * somewhere they aimed at a card and not at the ground — but a button still
   * down is a hand still steering, and taking that away every level would make
   * the hold useless exactly when the run gets hard.
   */
  clearPending(): void {
    this.pending = null;
  }

  /**
   * Drops everything, the held button included — what a pause needs.
   *
   * A pause is usually the window losing focus, and a right button held at the
   * moment focus goes may never deliver its `pointerup` at all. Keeping the
   * hold across that is how a player alt-tabs away and comes back to find
   * themselves in the middle of the horde.
   */
  reset(): void {
    this.clearPending();
    this.heldPointer = null;
  }

  private onPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.button !== SECONDARY_BUTTON) return;

    this.heldPointer = pointer.pointerId;
    this.cursorX = pointer.clientX;
    this.cursorY = pointer.clientY;
    // Read once on release, so letting go finishes the walk to where the
    // cursor last was rather than stopping the player mid-stride.
    this.pending = { x: pointer.clientX, y: pointer.clientY };

    // Without capture, releasing the button anywhere but over the canvas —
    // over the pause button, or outside the window entirely — sends the
    // `pointerup` somewhere else and leaves the player walking forever.
    const target = event.currentTarget as Partial<Element> | null;
    if (typeof target?.setPointerCapture === 'function') {
      target.setPointerCapture(pointer.pointerId);
    }
  };

  private onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== this.heldPointer) return;

    this.cursorX = pointer.clientX;
    this.cursorY = pointer.clientY;
    this.pending = { x: pointer.clientX, y: pointer.clientY };
  };

  private onPointerEnd = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== this.heldPointer) return;
    // `pointerup` names the button that came up; a cancel names none, and ends
    // the hold whatever was down.
    if (event.type === 'pointerup' && pointer.button !== SECONDARY_BUTTON) return;

    this.heldPointer = null;
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
