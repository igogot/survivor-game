import { weaponById } from '../data/weapons';
import { t, weaponName } from '../i18n';
import type { SpoilCategory, SpoilDef } from '../data/spoils';
import type { UpgradeDef } from '../data/upgrades';

/**
 * What a level-up card should say about one offer.
 *
 * Kept free of the DOM so the wording rules can be tested in plain Node, the
 * same split the simulation already relies on.
 */
export interface OfferLabel {
  /**
   * Card family, and so the accent treatment: anything scoped to a weapon is
   * louder than a global stat bump. Narrower than `UpgradeDef['kind']` on
   * purpose — the badge word carries the finer distinction.
   */
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
  const progress = isNew ? t('offer.new') : `${t('offer.level')} ${taken} → ${taken + 1}`;
  const scopedToWeapon = offer.kind === 'weapon' || offer.kind === 'weaponMod';

  return {
    // Colour groups the two weapon kinds; the badge separates them. Three
    // shades would be asking the player to learn a palette mid-fight.
    kind: scopedToWeapon ? 'weapon' : 'stat',
    badge: badgeFor(offer),
    isNew,
    isMax,
    progress: isMax ? `${progress} · ${t('offer.max')}` : progress,
  };
}

/**
 * `MOD` said the card was scoped to one weapon but not to which, and with two
 * upgrades per weapon in the pool a level-up can show two of them at once. The
 * weapon's own name costs the same space and answers the question the player is
 * actually asking.
 */
function badgeFor(offer: UpgradeDef): string {
  switch (offer.kind) {
    case 'weapon':
      return t('badge.weapon');
    case 'weaponMod': {
      // An id with no weapon behind it can only mean the pool and the weapon
      // list drifted apart; the old word still describes the card correctly.
      const weapon = weaponById(offer.weaponId);
      return weapon === undefined ? t('badge.mod') : weaponName(weapon).toUpperCase();
    }
    case 'stat':
      return t('badge.upgrade');
    default: {
      const unhandled: never = offer;
      throw new Error(`Unhandled upgrade kind: ${String(unhandled)}`);
    }
  }
}

/**
 * What a chest card should say about one spoil.
 *
 * Two things separate these from level-up cards and both have to be visible
 * without reading: which of the three questions this one answers, and that it
 * is gone the moment it is taken. A player who mistakes a spoil for an upgrade
 * spends the run waiting for a stat that is never coming.
 */
export interface SpoilLabel {
  /** Word shown in the card's corner badge: which question this answers. */
  readonly badge: string;
  /** Bottom line, in the place a level-up card puts its stack count. */
  readonly note: string;
}

const CATEGORY_BADGES = {
  survive: 'badge.survive',
  clear: 'badge.clear',
  gather: 'badge.gather',
} as const satisfies Record<SpoilCategory, string>;

export function describeSpoil(spoil: SpoilDef): SpoilLabel {
  return {
    badge: t(CATEGORY_BADGES[spoil.category]),
    // The one line every spoil shares, which is what makes it the family
    // trait rather than a property of any single card.
    note: t('spoil.oneUse'),
  };
}
