import { WEAPONS } from '../data/weapons';
import { weaponName, weaponRole } from '../i18n';
import type { SpriteName } from '../data/sprites';

/**
 * Draws a sprite into a canvas.
 *
 * Declared here rather than imported from the renderer so the interface layer
 * stays independent of Pixi: the picker asks for a capability, and whoever can
 * paint supplies one.
 */
export type SpritePainter = (name: SpriteName, canvas: HTMLCanvasElement) => void;

/** One weapon offered on the opening screen. */
export interface StarterChoice {
  readonly id: string;
  readonly name: string;
  /** The figure the player becomes by choosing it. */
  readonly sprite: SpriteName;
  /** What the weapon is for — the same line the rules panel prints. */
  readonly detail: string;
  /** The weapon's own colour, which the card is accented with. */
  readonly color: number;
  /** The digit that picks this card, matching the level-up screen's keys. */
  readonly key: string;
}

/**
 * The opening choice, built from the weapons themselves.
 *
 * Every weapon can open a run: there is no separate list of starters to fall
 * out of step with `WEAPONS`, so a fourth weapon is offered the moment it
 * exists rather than the moment somebody remembers to add it here. That the
 * cards are numbered from 1 like the level-up screen is deliberate — it is the
 * same gesture, made once before the run instead of during it.
 */
export function starterChoices(): readonly StarterChoice[] {
  return WEAPONS.map((def, index) => ({
    id: def.id,
    name: weaponName(def),
    sprite: def.playerSprite,
    detail: weaponRole(def.id),
    color: def.color,
    key: String(index + 1),
  }));
}

/** CSS colour for a weapon's accent, which the data holds as a number. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
