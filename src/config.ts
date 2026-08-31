/**
 * Every tunable number lives here. Balancing a survivor-like is mostly editing
 * this file and replaying, so nothing gameplay-related should be hard-coded in
 * the systems themselves.
 */
export const CONFIG = {
  /** Simulation ticks per second. Rendering interpolates between ticks. */
  tickRate: 60,
  /** Longest frame the loop will integrate; guards against the spiral of death. */
  maxFrameTime: 0.25,

  /**
   * The run has no length. A boss arrives on this cadence and killing one only
   * buys the next interval, so the only way a run ends is the player dying.
   */
  boss: {
    /** Seconds between arrivals. The first boss lands at this mark. */
    interval: 600,
    /** Quiet seconds before each arrival. */
    lull: 12,
    /**
     * Quiet seconds *after* an arrival, before the horde comes back anyway.
     *
     * Without a bound the duel is a place to rest rather than a fight. The
     * spawner is off while the boss lives, the boss is slower than the player,
     * and the stand measured what that combination produces: duels of 407s and
     * 1162s in which the player takes literally no damage — one seed spent
     * nineteen minutes of a forty-minute run with the game switched off.
     *
     * Long enough to hold most first duels whole (measured at 37s, 73s and
     * 89s), short enough that one the player cannot finish is fought in
     * traffic.
     */
    duelGrace: 60,
    /**
     * Extra HP each boss carries over the one before it, as a fraction.
     *
     * Boss HP is deliberately not on the horde's per-minute curve. That curve
     * is 24x by minute 46 and would turn the second duel into a wall; counting
     * bosses instead ties the difficulty to what the player has actually done.
     */
    hpScalePerBoss: 0.8,
  },

  player: {
    radius: 12,
    maxHp: 100,
    moveSpeed: 175,
    /** Invulnerability window after taking a hit. */
    invulnTime: 0.5,
    /** Gems inside this radius fly toward the player. */
    pickupRadius: 75,
    /** Gems inside this radius are collected. */
    collectRadius: 20,
    magnetSpeed: 280,
  },

  spawn: {
    /** Enemies appear on a ring this far out, always off-screen. */
    ringRadius: 780,
    /** Enemies that wander further than this are recycled. */
    despawnRadius: 1500,
    /** Hard ceiling that protects the frame rate. */
    maxEnemies: 600,
    baseInterval: 0.8,
    /** Spawn frequency grows linearly with this. Quadratic growth pins the cap. */
    pressurePerMinute: 0.45,
    /** Enemies added per spawn tick, growing with this. */
    batchPerMinute: 0.3,
    hpScalePerMinute: 0.5,

    /** Fraction of spawns placed in the player's path instead of anywhere. */
    aheadBias: 0.65,
    /** Half-width of the arc those spawns use, in radians. */
    aheadSpread: 1.0,

    /** Seconds in one surge-and-lull cycle. */
    wavePeriod: 42,
    /** Seconds of that cycle spent surging. */
    waveSurge: 14,
    /** Spawn rate multiplier at the peak of a surge. */
    wavePeak: 2.4,
  },

  grid: {
    /** Roughly 3x the common enemy radius: few cells per query, few candidates per cell. */
    cellSize: 64,
  },

  camera: {
    zoom: 1,
  },
} as const;
