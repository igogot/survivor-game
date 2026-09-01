/**
 * What each boss can do besides walk at you.
 *
 * Ten of them, and the nth boss of a run takes the nth entry — so the first ten
 * duels are ten different fights and nobody sees the same trick twice before
 * they have seen all of them. Deliberately a rotation and not a draw: a random
 * pick would spend numbers from the run's generator, and every seed in the
 * balance table would move the moment this file was touched. It also means a
 * player can learn the order, which is the point of a boss being an event
 * rather than a bigger grunt.
 *
 * Definitions carry numbers only. `src/systems/bossAbility.ts` switches on the
 * id and does the work, the same way `weaponSystem` switches on a weapon's kind
 * — which is what keeps this file free of any import from the simulation.
 */

export type BossAbilityId =
  | 'charge'
  | 'summon'
  | 'volley'
  | 'burst'
  | 'quake'
  | 'enrage'
  | 'leech'
  | 'blink'
  | 'ward'
  | 'thorns';

/**
 * Whether the ability fires on a timer or is simply always true.
 *
 * The split matters to the system rather than to the player: an active ability
 * needs a cooldown and a tell, a passive one needs neither and must never be
 * written as a cooldown of zero — that is a use every tick.
 */
export type BossAbilityKind = 'active' | 'passive';

export interface BossAbilityDef {
  readonly id: BossAbilityId;
  readonly kind: BossAbilityKind;
  /** Seconds between uses. Ignored for a passive. */
  readonly cooldown: number;
  /**
   * Seconds the effect lasts once used.
   *
   * Only the abilities that leave the boss in a different state for a while —
   * charging, warded — read this. For the rest a use is instantaneous.
   */
  readonly duration: number;
  /** The one number the ability turns on, meaning whatever its routine says. */
  readonly power: number;
}

/**
 * In the order the first ten duels meet them.
 *
 * The order is a difficulty curve as much as a list. The first boss only moves
 * differently; shots and summons come once the player has a weapon or two;
 * `ward` and `thorns`, which punish how the player is fighting rather than
 * where they are standing, come last because they are the two that need the
 * player to already have a habit for them to interrupt.
 */
export const BOSS_ABILITIES: readonly BossAbilityDef[] = [
  {
    // A run at the player, three times its walking speed. The tell is that it
    // stops first: `duration` is short enough that a player who moves at all
    // is missed, which makes standing still the mistake.
    id: 'charge',
    kind: 'active',
    cooldown: 6,
    duration: 1.1,
    power: 3,
  },
  {
    // Bodies, not damage. The duel is quiet by design, and this is the ability
    // that takes the quiet away.
    id: 'summon',
    kind: 'active',
    cooldown: 9,
    duration: 0,
    power: 4,
  },
  {
    // Three aimed shots, led the way a caster leads. Turning beats them.
    id: 'volley',
    kind: 'active',
    cooldown: 5,
    duration: 0,
    power: 3,
  },
  {
    // A ring in every direction, which cannot be dodged by turning — only by
    // being far enough away when it goes off, or close enough to be inside it.
    id: 'burst',
    kind: 'active',
    cooldown: 7,
    duration: 0,
    power: 10,
  },
  {
    // The floor, not the air: everything within reach is hit at once. This is
    // the one that punishes fighting a boss from arm's length.
    id: 'quake',
    kind: 'active',
    cooldown: 6.5,
    duration: 0,
    power: 190,
  },
  {
    // Faster the closer it is to dying, so the last tenth of the fight is the
    // dangerous one. `power` is how much speed it has gained at zero health.
    id: 'enrage',
    kind: 'passive',
    cooldown: 0,
    duration: 0,
    power: 1.1,
  },
  {
    // Heals while it is touching somebody, so a player who trades with it
    // loses the trade. `power` is the fraction of its own health per second.
    id: 'leech',
    kind: 'passive',
    cooldown: 0,
    duration: 0,
    power: 0.02,
  },
  {
    // Closes the distance the player spent the whole duel making. The counter
    // is that it arrives *beside* them rather than on them — `power` is how far
    // outside touching range it lands, so it never blinks into a free hit.
    id: 'blink',
    kind: 'active',
    cooldown: 8,
    duration: 0,
    power: 30,
  },
  {
    // A window where it barely takes damage. Nothing to dodge: the answer is
    // to stop spending cooldowns into it and keep moving until it drops.
    id: 'ward',
    kind: 'active',
    cooldown: 11,
    duration: 3.5,
    power: 0.25,
  },
  {
    // Sends a share of every hit back at whoever is nearest. The only ability
    // that scales with the player's own damage, which is why it comes tenth —
    // by then there is enough of it for this to mean something.
    id: 'thorns',
    kind: 'passive',
    cooldown: 0,
    duration: 0,
    power: 0.06,
  },
];

/**
 * The ability the nth boss of a run carries, counting from zero.
 *
 * Wraps after ten, so the eleventh duel is the first fight again — against a
 * boss with eleven times the health, which is a different fight even with the
 * same trick in it.
 */
export function bossAbility(index: number): BossAbilityDef {
  const count = BOSS_ABILITIES.length;
  const wrapped = ((index % count) + count) % count;
  return BOSS_ABILITIES[wrapped];
}

export function bossAbilityById(id: string): BossAbilityDef | undefined {
  return BOSS_ABILITIES.find((ability) => ability.id === id);
}
