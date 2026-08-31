import { stickIntent, stickKnob } from './touch';
import type { Vector } from './touch';

/**
 * A floating thumb stick, sampled once per tick like the keyboard.
 *
 * The stick has no fixed place on screen: it appears wherever the finger lands
 * and measures from there. A stick painted into a corner makes the player look
 * away from the horde to find it, which is the one thing this genre never gives
 * them time for — and on a phone their thumb is already resting over that
 * corner anyway.
 *
 * Only the first finger down steers. A second one is left alone so it can hit
 * an upgrade card, and so a palm resting on the glass cannot take the stick
 * away from the thumb that is using it.
 */
export class TouchInput {
  /** Normalized movement intent, magnitude 0..1. Zero while nothing is held. */
  x = 0;
  y = 0;

  private surface: EventTarget | null = null;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private offsetX = 0;
  private offsetY = 0;

  /** True while a finger is steering — the view draws the ring only then. */
  get active(): boolean {
    return this.pointerId !== null;
  }

  /** Where the finger landed, in client pixels. */
  get origin(): Vector {
    return { x: this.originX, y: this.originY };
  }

  /** Knob position relative to `origin`, clamped to the ring. */
  get knob(): Vector {
    return stickKnob(this.offsetX, this.offsetY);
  }

  attach(surface: EventTarget): void {
    this.detach();
    this.surface = surface;
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerEnd);
    surface.addEventListener('pointercancel', this.onPointerEnd);
  }

  detach(): void {
    const surface = this.surface;
    if (surface === null) return;

    surface.removeEventListener('pointerdown', this.onPointerDown);
    surface.removeEventListener('pointermove', this.onPointerMove);
    surface.removeEventListener('pointerup', this.onPointerEnd);
    surface.removeEventListener('pointercancel', this.onPointerEnd);
    this.surface = null;
    this.reset();
  }

  /** Drops the stick without waiting for a finger up — used when a run pauses. */
  reset(): void {
    this.pointerId = null;
    this.offsetX = 0;
    this.offsetY = 0;
    this.x = 0;
    this.y = 0;
  }

  private onPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (this.pointerId !== null) return;

    this.pointerId = pointer.pointerId;
    this.originX = pointer.clientX;
    this.originY = pointer.clientY;
    this.offsetX = 0;
    this.offsetY = 0;
    this.x = 0;
    this.y = 0;

    // Without capture, lifting the finger over any element that accepts pointer
    // events — the pause button it drifted onto — sends the `pointerup`
    // somewhere else and leaves the player walking into the horde forever.
    const target = event.currentTarget as Partial<Element> | null;
    if (typeof target?.setPointerCapture === 'function') {
      target.setPointerCapture(pointer.pointerId);
    }
  };

  private onPointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== this.pointerId) return;

    this.offsetX = pointer.clientX - this.originX;
    this.offsetY = pointer.clientY - this.originY;

    const intent = stickIntent(this.offsetX, this.offsetY);
    this.x = intent.x;
    this.y = intent.y;
  };

  private onPointerEnd = (event: Event): void => {
    if ((event as PointerEvent).pointerId !== this.pointerId) return;
    this.reset();
  };
}
