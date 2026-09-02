/**
 * What each boss can do besides walk at you.
 *
 * Ten of them, and each boss of a run takes the next entry — so ten duels are
 * ten different fights and nobody sees the same trick twice before they have
 * seen all of them. Deliberately a rotation and not a draw: a random pick per
 * boss would spend numbers from the run's generator, and every seed in the
 * balance table would move the moment this file was touched. It also means a
 * player can learn the order, which is the point of a boss being an event
 * rather than a bigger grunt.
 *
 * Where the rotation *starts* is the run's, not the list's. See
 * `rotationStart`, and the note there about the nine fights nobody was ever
 * shown.
 *
 * Definitions carry numbers only. `src/systems/bossAbility.ts` switches on the
 * id and does the work, the same way `weaponSystem` switches on a weapon's kind
 * — which is what keeps this file free of any import from the simulation.
 */
import { Rng } from '../core/rng';

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
 * In the order a run meets them, from wherever that run begins.
 *
 * The order is a shape as much as a list: `charge` only moves differently,
 * shots and summons add something to dodge, and `ward` and `thorns` punish how
 * the player is fighting rather than where they are standing. It used to be a
 * difficulty curve, on the reasoning that the first duel meets a player with
 * one weapon. That reasoning has not been true for a long time — the first duel
 * lands at minute ten, against a level-thirty player carrying a full kit — and
 * it was the excuse for pinning every run to the top of the list. What is left
 * is a good order to meet ten things in, which is all it needs to be.
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
    //
    // `power` is damage, and it is worth saying so out loud: it was 190 for a
    // while, which is the *radius* — against a hundred points of health that
    // was not a hard ability, it was an instant loss every six seconds. A
    // little more than a body's touch, because unlike a body it can be walked
    // away from.
    id: 'quake',
    kind: 'active',
    cooldown: 6.5,
    duration: 0,
    power: 34,
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
    //
    // Capped in `bossToll`, and the cap is the whole reason it is shippable: a
    // share of a hit is a share of a number that grows all run, so by the
    // hundredth minute an uncapped reflection would kill a full-health player
    // in about two seconds no matter what they did.
    id: 'thorns',
    kind: 'passive',
    cooldown: 0,
    duration: 0,
    power: 0.06,
  },
];

/**
 * The ability at a place in the rotation, counting from zero.
 *
 * Wraps, so the eleventh duel of a run is its first fight again — against a
 * boss with eleven times the health, which is a different fight even with the
 * same trick in it. Negative indices wrap the same way, which is what lets a
 * caller subtract a run's starting point to ask for a fight by name.
 */
export function bossAbility(index: number): BossAbilityDef {
  const count = BOSS_ABILITIES.length;
  const wrapped = ((index % count) + count) % count;
  return BOSS_ABILITIES[wrapped];
}

export function bossAbilityById(id: string): BossAbilityDef | undefined {
  return BOSS_ABILITIES.find((ability) => ability.id === id);
}

/**
 * Decorrelates a run's rotation from the run itself.
 *
 * Without it `rotationStart` would be reading the same first number the run's
 * own generator produces, and which fight a seed brings would move in lockstep
 * with its first spawn angle. Any odd constant does; this one is arbitrary and
 * must not change, because changing it reshuffles which fight every seed brings
 * and moves every stand table for no reason.
 */
const ROTATION_SALT = 0x5f3a7c1d;

/**
 * Where a run's rotation begins.
 *
 * This exists because of a measurement. The rotation was written for a game
 * whose runs reached minute a hundred: ten duels, one every ten minutes. Runs
 * end between minute seven and minute fourteen, so a run has **one** duel in
 * it — and with every run pinned to the top of the list, that duel was always
 * `charge`. Nine of the ten fights were content nobody had ever seen, and no
 * stand covered them because a stand plays runs too.
 *
 * A run with one duel in it cannot be shown ten fights. What it can be shown is
 * a different one of them each time. So the starting point belongs to the run
 * and the order does not: inside a single run the rotation is exactly what it
 * always was, and a player who has seen the first duel knows what the second
 * brings.
 *
 * Its own generator, seeded off the run's seed rather than drawn from it. The
 * run's generator is spent by spawn angles, enemy types and upgrade offers, and
 * taking a number out of it here would move every seed in the balance table —
 * see the test that holds that line.
 */
export function rotationStart(seed: number): number {
  return new Rng(seed ^ ROTATION_SALT).int(0, BOSS_ABILITIES.length);
}
