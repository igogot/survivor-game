import type { UpgradeDef } from '../data/upgrades';

/**
 * What a level-up card should say about one offer.
 *
 * Kept free of the DOM so the wording rules can be tested in plain Node, the
 * same split the simulation already relies on.
 */
export interface OfferLabel {
  /** Weapons change how a run plays, so their cards get a louder treatment. */
  readonly kind: 'weapon' | 'stat';
  /** Word shown in the card's corner badge. */
  readonly badge: string;
  /** True when taking this grants something the player does not have yet. */
  readonly isNew: boolean;
  /** True when taking this puts the offer at its stack cap. */
  readonly isMax: boolean;
  /** Bottom line of the card: 'NEW' on the first take, 'Lv 2 → 3' after. */
  readonly progress: string;
}

/**
 * Two things need to be legible at a glance and were previously collapsed into
 * one `n / max` ratio: whether an offer is a weapon or a stat bump, and whether
 * it is a first acquisition or another level of something owned. Picks are made
 * in a couple of seconds, so a difference that needs the description read is
 * not a difference the player acts on.
 */
export function describeOffer(offer: UpgradeDef, taken: number): OfferLabel {
  const isNew = taken === 0;
  const isMax = taken + 1 >= offer.maxStacks;
  const progress = isNew ? 'NEW' : `Lv ${taken} → ${taken + 1}`;

  return {
    kind: offer.kind,
    badge: offer.kind === 'weapon' ? 'WEAPON' : 'UPGRADE',
    isNew,
    isMax,
    progress: isMax ? `${progress} · MAX` : progress,
  };
}
