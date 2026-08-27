/**
 * Uniform spatial hash — the collision broad-phase.
 *
 * The naive approach checks every projectile against every enemy. At the
 * densities this game targets (500+ enemies, dozens of projectiles) that is
 * tens of thousands of distance checks per tick and the frame rate collapses
 * well before the interesting part of a run.
 *
 * The grid buckets entities into fixed-size cells, so a query only visits the
 * cells the query circle actually overlaps. It is deliberately conservative:
 * it may return candidates that turn out to be too far away, but it never
 * misses one that overlaps — tests/grid.test.ts asserts exactly that against a
 * brute-force reference.
 *
 * Rebuilt from scratch every tick. That sounds wasteful but is just pushing
 * integers into pre-grown arrays, and it sidesteps the whole class of bugs
 * around incrementally moving entities between cells.
 */
export class SpatialGrid {
  private readonly buckets = new Map<number, number[]>();

  constructor(private readonly cellSize: number) {}

  /** Empties the buckets without releasing their backing arrays. */
  clear(): void {
    for (const bucket of this.buckets.values()) {
      bucket.length = 0;
    }
  }

  insert(index: number, x: number, y: number): void {
    const key = cellKey(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(index);
  }

  /**
   * Writes candidate indices overlapping the circle into `out` and returns it.
   * `out` is expected to be a long-lived scratch array — the tick allocates
   * nothing.
   */
  query(x: number, y: number, radius: number, out: number[]): number[] {
    out.length = 0;

    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const bucket = this.buckets.get(cellKey(cellX, cellY));
        if (bucket === undefined) continue;
        for (let i = 0; i < bucket.length; i++) {
          out.push(bucket[i]);
        }
      }
    }

    return out;
  }
}

/**
 * Packs a signed cell coordinate pair into a single integer key.
 *
 * Cells wrap past ±32768, which would alias distant regions onto each other.
 * The playfield only ever spans a few dozen cells around the player, so that
 * limit is three orders of magnitude away.
 */
function cellKey(cellX: number, cellY: number): number {
  return ((cellX & 0xffff) << 16) | (cellY & 0xffff);
}
