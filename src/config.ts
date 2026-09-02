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
    /**
     * Seconds between arrivals. The first boss lands at this mark.
     *
     * Halved from ten minutes, and the halving is not the whole change — see
     * `duelGrace`. A duel is quiet: the spawner is off while the boss lives, so
     * twice as many bosses is twice as much time with the horde switched off.
     * Measured on twenty seeds, the interval alone took deaths inside the
     * stand's window from 9 to 3. More bosses, less game.
     */
    interval: 300,
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
     *
     * Cut from 60 when the interval halved, to pay some of the quiet back. The
     * number was chosen by measuring rather than by taste, and the interesting
     * part is what happened at 30: deaths went from 9 to 14, because below
     * about forty seconds the horde is back before most duels end and every
     * boss is fought in traffic. That is not "less rest", it is a different
     * fight. 45 stays on the near side of that edge.
     */
    duelGrace: 45,
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
    /**
     * Seconds a downed player waits per teammate, so a pair wait a minute, a
     * three two and a four three. See `respawnDelay`.
     */
    respawnPerTeammate: 60,
    /**
     * Grace on coming back, which is longer than a hit's.
     *
     * A player returns beside the one they were watching, and that player is
     * being watched because they are alive in the middle of something. Half a
     * second would be a respawn spent on the tick it happened.
     */
    respawnGrace: 2,
    /** Gems inside this radius fly toward the player. */
    pickupRadius: 75,
    /** Gems inside this radius are collected. */
    collectRadius: 20,
    magnetSpeed: 280,
  },

  /**
   * The only thing in the world that is not the player, the horde or what the
   * horde drops.
   *
   * One chest exists at a time and it never expires, so the arrow pointing at
   * it is a standing offer rather than something that can be missed. Reaching
   * it is the cost: it is placed behind the player, which is the ground they
   * have already crossed and the crowd they have already outrun.
   */
  chest: {
    /** Seconds before the first one is placed. */
    firstAt: 75,
    /** Seconds from one being opened to the next being placed. */
    interval: 150,
    /** How far from the player one appears. Roughly five seconds of running. */
    distance: 900,
    /** Half-width of the arc behind the player it is placed in, in radians. */
    spread: 1.2,
    /**
     * How far a chest may fall behind before it is put down again, closer.
     *
     * A chest can be outrun — it is placed behind and the player is faster
     * than everything chasing them — and one left far enough back blocks every
     * later chest for the rest of the run, because the next is not scheduled
     * until this one is taken. The stand found that with the bot, on the base
     * before the spear and the harpoon: a seed that spent 69% of its run with
     * a chest lying 6628 units away, two collected in twelve minutes, level 10
     * where the same seed used to reach 29. This guard is what stops that
     * being reproducible now.
     *
     * Put down again rather than taken away, because nothing was spent and the
     * offer should still stand. Twice the walk, so an honest detour never sees
     * it move.
     */
    abandonAt: 1800,
    /** Drawn size, and half of what it takes to walk into one. */
    radius: 18,
    /** What a mend restores, as a fraction of maximum health. */
    mendFraction: 0.5,
    /** How far a harvest reaches for the gems the player left behind. */
    harvestRadius: 1200,
    /** Seconds a harvest keeps pulling. */
    harvestTime: 4,
    /**
     * How fast a harvested gem travels, in units per second.
     *
     * Faster than the ordinary magnet because it has to cross `harvestRadius`
     * inside `harvestTime` even while the player runs the other way. A pull
     * that expires mid-flight would quietly deliver less than the card
     * promises, which is the one thing a one-use reward may not do.
     */
    harvestSpeed: 800,
  },

  spawn: {
    /** Enemies appear on a ring this far out, always off-screen. */
    ringRadius: 780,
    /** Enemies that wander further than this are recycled. */
    despawnRadius: 1500,
    /** Hard ceiling that protects the frame rate. */
    maxEnemies: 600,
    baseInterval: 0.8,
    /**
     * Spawn frequency grows linearly with this. Quadratic growth pins the cap.
     *
     * Raised from 0.45, and the number came from `npm run curve` rather than from
     * taste. The probe said the game is thin at the start rather than soft at
     * the end: two minutes in, a tenth of the ceiling is occupied, and it stays
     * under a third until minute eight. The cap only binds around twelve, so
     * there was headroom to spend.
     *
     * Raising this alone costs boss kills badly — runs start ending before
     * minute ten, which is where the boss used to be. It only pays for itself
     * alongside a boss every five minutes, which is why the two landed
     * together. See the README for both halves.
     *
     * Why 0.55 and not more. The stand cannot tell 0.55 from 0.7: an
     * intermediate 0.58 measured *worse* than 0.7 on twenty seeds, which is
     * impossible and is therefore the size of the noise. What can tell them
     * apart is the opening. A player who has not learned to kite — the circling
     * bot in `runHeadless` — reaches level two on three seeds of four at 0.55
     * and on none at all at 0.7. Losing a run is the game; never seeing a
     * level-up screen is the game failing to teach itself. When one measure is
     * blind and the other is not, the number comes from the one that can see.
     */
    pressurePerMinute: 0.55,
    /** Enemies added per spawn tick, growing with this. */
    batchPerMinute: 0.3,
    hpScalePerMinute: 0.5,

    /**
     * How the party multiplier is split between arrivals and health.
     *
     * A party of N has to meet N times the horde, and there are exactly two
     * places to put that: more bodies arriving, or tougher ones. They are not
     * additive — they are two ends of one slider, and the reason is arithmetic
     * rather than taste.
     *
     * In equilibrium the horde is killed as fast as it arrives. With arrivals
     * multiplied by A and health by H, a party of N kills `N·damage / (H·hp)`
     * bodies a second and meets `A·rate` of them, so staying in equilibrium
     * requires `A · H = N`. Turn both up and the horde outruns the party by a
     * factor of N and pins itself against `maxEnemies` for the rest of the run.
     *
     * This is the exponent that divides the two: `A = N^k`, `H = N^(1-k)`.
     * At 0 the whole multiplier is health, at 1 the whole of it is arrivals.
     * Which end is right is a question about *threat* rather than throughput:
     * both ends kill the horde at the same rate, and only the arrivals end puts
     * a solo-sized crowd around each player. The slider was measured across its
     * whole range rather than argued about, and the honest reading is that
     * neither end reaches threat parity — see the README. It sits at 0, so the
     * party's multiplier is entirely health: four players meet a solo player's
     * crowd with four times the health in it.
     */
    perPlayerArrivals: 0,

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
