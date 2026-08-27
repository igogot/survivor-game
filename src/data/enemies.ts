export interface EnemyDef {
  readonly id: string;
  readonly hp: number;
  readonly speed: number;
  readonly damage: number;
  readonly radius: number;
  readonly xp: number;
  readonly color: number;
  /** Seconds into the run before this type starts appearing. */
  readonly unlockAt: number;
  /** Relative spawn weight among the types unlocked so far. */
  readonly weight: number;
}

export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'grunt',
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
    id: 'brute',
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
