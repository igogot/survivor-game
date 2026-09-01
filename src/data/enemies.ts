import type { SpriteName } from './sprites';

export interface EnemyDef {
  readonly id: string;
  readonly hp: number;
  readonly speed: number;
  readonly damage: number;
  readonly radius: number;
  readonly xp: number;
  readonly color: number;
  /** Which silhouette the renderer draws for this type. */
  readonly sprite: SpriteName;
  /** Seconds into the run before this type starts appearing. */
  readonly unlockAt: number;
  /** Relative spawn weight among the types unlocked so far. */
  readonly weight: number;
  /**
   * What this leaves behind when killed.
   *
   * One object rather than a pair of optional fields, so "splits into nothing
   * twice" is not expressible. The children are spawned by `reapSystem`, which
   * is already where death is handled.
   */
  readonly split?: { readonly into: string; readonly count: number };
  /**
   * Attacks from a distance instead of by touching.
   *
   * The horde's only answer to a player it cannot catch. Contact damage needs
   * the enemy to reach the player, and nothing in the game can: the fastest
   * type runs at 96 against a player at 175, or 275 once Light Boots are
   * bought. A thrown hex travels at its own speed and does not care.
   */
  /**
   * Goes off where it falls, hurting the player and nobody else.
   *
   * The one thing in the game that gives killing a cost. Everything else on
   * the field is strictly better dead, so "kill it" was never a decision;
   * this asks *with what, and from how far*.
   */
  readonly detonate?: { readonly radius: number; readonly damage: number };
  readonly ranged?: {
    /** Distance it holds, and the furthest it will throw from. */
    readonly range: number;
    /** Seconds between throws. */
    readonly cooldown: number;
    readonly projectileSpeed: number;
    readonly projectileRadius: number;
    readonly damage: number;
    /** Seconds a hex stays in the air before fizzling. */
    readonly life: number;
  };
}

export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'grunt',
    sprite: 'grunt',
    hp: 10,
    speed: 52,
    damage: 6,
    radius: 10,
    xp: 1,
    color: 0xe05a5a,
    unlockAt: 0,
    weight: 10,
  },
  {
    id: 'runner',
    sprite: 'runner',
    hp: 6,
    speed: 96,
    damage: 4,
    radius: 8,
    xp: 1,
    color: 0xe0a13a,
    unlockAt: 90,
    weight: 6,
  },
  {
    /*
     * The first enemy that is not just another point on the hp/speed line.
     * Killing it is a choice with a consequence — the crowd it leaves is
     * faster than it was — which is something no amount of retuning the other
     * three could produce.
     *
     * Its damage sits below the brute's on purpose. Contact damage takes only
     * the single largest hit in range, so the hardest-hitting type sets the
     * horde's entire damage ceiling; raising it here would make this a change
     * to how lethal the game is rather than to what is in it.
     */
    id: 'splitter',
    sprite: 'splitter',
    hp: 30,
    speed: 44,
    damage: 10,
    radius: 15,
    xp: 3,
    color: 0x5ac08a,
    unlockAt: 420,
    weight: 2,
    split: { into: 'spawnling', count: 2 },
  },
  {
    /*
     * Kills the idea that killing is free.
     *
     * Its blast reaches 60, which puts the blade ring inside it and the bolt's
     * 430 far outside, so which weapon finishes it decides whether it costs
     * anything. That is the first time a weapon choice in this game has a
     * consequence beyond a damage number.
     *
     * The blast is 22 rather than something smaller on purpose. Contact damage
     * takes only the largest single hit in range, so anything under the
     * brute's 14 would land inside the same invulnerability window and *shield*
     * the player from a bigger hit instead of hurting them — measured on the
     * caster's hex before it was tuned.
     *
     * Slow on purpose too. It has to be killable on the way in, or the choice
     * of weapon never gets to matter.
     */
    id: 'bomber',
    sprite: 'bomber',
    hp: 22,
    speed: 46,
    damage: 5,
    radius: 13,
    xp: 4,
    color: 0xffb454,
    unlockAt: 660,
    weight: 0.5,
    detonate: { radius: 60, damage: 22 },
  },
  {
    /*
     * The enemy that reaches a player who keeps their distance.
     *
     * It holds `range` and throws. The hex is aimed where the player is going
     * rather than where they are — at 205 against a player at up to 275 an
     * unled shot would miss every time, and leading is also what makes the
     * counter a decision instead of a reflex: the lead assumes the player keeps
     * their heading, so turning beats it and running straight does not.
     *
     * Contact damage stays low. Walking into one should be the least of the
     * problem it presents.
     */
    id: 'caster',
    sprite: 'caster',
    hp: 26,
    speed: 40,
    damage: 4,
    radius: 12,
    xp: 4,
    color: 0xc9d6ff,
    unlockAt: 900,
    weight: 0.35,
    ranged: {
      range: 240,
      cooldown: 4,
      projectileSpeed: 205,
      projectileRadius: 7,
      damage: 9,
      life: 3.2,
    },
  },
  {
    /*
     * Never rolled: `unlockAt` keeps it out of `rollEnemyDef` forever, exactly
     * as it does for the boss. It exists only at the end of a splitter.
     */
    id: 'spawnling',
    sprite: 'spawnling',
    hp: 4,
    speed: 74,
    damage: 4,
    radius: 7,
    xp: 1,
    color: 0x9fd8b0,
    unlockAt: Number.POSITIVE_INFINITY,
    weight: 0,
  },
  {
    id: 'brute',
    sprite: 'brute',
    hp: 55,
    speed: 34,
    damage: 14,
    radius: 17,
    xp: 4,
    color: 0x8f4fd0,
    unlockAt: 180,
    weight: 3,
  },
];

export const BOSS: EnemyDef = {
  id: 'boss',
  sprite: 'boss',
  hp: 4000,
  speed: 46,
  damage: 30,
  radius: 44,
  xp: 200,
  color: 0xff2e63,
  unlockAt: Number.POSITIVE_INFINITY,
  weight: 0,
};

/**
 * Precomputed so the broad-phase knows how far to widen a query: a candidate
 * only counts if the circles overlap, and the largest possible enemy radius is
 * the padding that guarantees no miss.
 */
export const MAX_ENEMY_RADIUS = ENEMIES.reduce(
  (max, def) => Math.max(max, def.radius),
  BOSS.radius,
);

/**
 * The richest gem any single kill can drop.
 *
 * Read rather than typed, because it is what bounds how fast a run can level:
 * XP has one source, so the most a kill can be worth is the most any enemy is
 * worth. The boss is in the reduction on purpose — it drops a gem like
 * everything else, and it is worth two hundred of them.
 */
export const MAX_ENEMY_XP = ENEMIES.reduce((max, def) => Math.max(max, def.xp), BOSS.xp);

const BY_ID = new Map<string, EnemyDef>([...ENEMIES, BOSS].map((def) => [def.id, def]));

/**
 * Returns `undefined` for an unknown id rather than throwing — a split naming a
 * type that no longer exists should cost the run nothing, the same contract
 * `weaponById` keeps.
 */
export function enemyById(id: string): EnemyDef | undefined {
  return BY_ID.get(id);
}
