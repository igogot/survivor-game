/**
 * What a chest can hold.
 *
 * Deliberately a different axis from `UPGRADES`. An upgrade is a permanent
 * multiplier chosen while the run is stopped for levelling; a spoil is spent
 * the instant it is taken and never appears on a stat line. Mixing the two
 * pools would have put a card that changes the next second beside one that
 * changes the next ten minutes, and the player has a couple of seconds to tell
 * them apart.
 *
 * Definitions carry no behaviour. `src/systems/chests.ts` switches on the id
 * and does the work, the same way `weaponSystem` switches on a weapon's kind —
 * which is what keeps this file free of any import from the simulation and
 * therefore free of the cycle that an `apply(world)` would create.
 */

/**
 * The three things a chest can be for.
 *
 * One spoil of each is offered, always, so the choice is never between two
 * shades of the same answer. It also means a chest is worth opening in any
 * state a run can be in: hurt, buried, or neither.
 */
export type SpoilCategory = 'survive' | 'clear' | 'gather';

export type SpoilId = 'mend' | 'purge' | 'harvest';

export interface SpoilDef {
  readonly id: SpoilId;
  readonly category: SpoilCategory;
  readonly name: string;
  readonly description: string;
}

/** In the order their cards appear, which is the order of the categories. */
export const SPOIL_CATEGORIES: readonly SpoilCategory[] = ['survive', 'clear', 'gather'];

export const SPOILS: readonly SpoilDef[] = [
  {
    id: 'mend',
    category: 'survive',
    name: 'Field Dressing',
    // Says plainly that it can be wasted. Health is the one resource this game
    // never gave back, so the first instinct is to take this every time.
    description: 'Restores half your health. Anything above full is thrown away.',
  },
  {
    id: 'purge',
    category: 'clear',
    name: 'Clean Sweep',
    description: 'Kills the whole horde where it stands, gems and all. A boss shrugs it off.',
  },
  {
    id: 'harvest',
    category: 'gather',
    name: 'Loose Change',
    description: 'Every gem you walked past comes to you, from further than you can see.',
  },
];

export function spoilById(id: string): SpoilDef | undefined {
  return SPOILS.find((spoil) => spoil.id === id);
}

/** Every spoil of one category, in declaration order. */
export function spoilsOf(category: SpoilCategory): readonly SpoilDef[] {
  return SPOILS.filter((spoil) => spoil.category === category);
}
