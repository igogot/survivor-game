import { STICK_RADIUS } from '../core/touch';
import { requireElement } from './hud';
import type { TouchInput } from '../core/touch-input';

/**
 * Draws the thumb stick.
 *
 * Two divs rather than sprites: the stick belongs to the interface, not to the
 * world, and putting it in the DOM keeps it out of the camera transform — a
 * ring that scrolled with the arena would be worse than no ring at all.
 */
export class StickView {
  private readonly root = requireElement('stick');
  private readonly knob = requireElement('stick-knob');

  constructor() {
    this.root.style.setProperty('--stick-radius', `${STICK_RADIUS}px`);
  }

  update(touch: TouchInput): void {
    if (!touch.active) {
      this.root.hidden = true;
      return;
    }

    const origin = touch.origin;
    const knob = touch.knob;

    this.root.hidden = false;
    this.root.style.left = `${origin.x}px`;
    this.root.style.top = `${origin.y}px`;
    this.knob.style.transform = `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`;
  }
}
