/**
 * Object pool for the three entity types that churn hardest: enemies,
 * projectiles and XP gems.
 *
 * A ten-minute run spawns tens of thousands of each. Allocating them fresh
 * hands the GC a steady stream of short-lived objects and shows up as periodic
 * frame spikes. Recycling keeps allocation flat after the first minute — watch
 * the `allocated` counter in the debug overlay plateau while the game keeps
 * spawning.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  private allocatedCount = 0;

  constructor(
    private readonly factory: () => T,
    prealloc = 0,
  ) {
    for (let i = 0; i < prealloc; i++) {
      this.free.push(this.factory());
      this.allocatedCount++;
    }
  }

  obtain(): T {
    const recycled = this.free.pop();
    if (recycled !== undefined) return recycled;
    this.allocatedCount++;
    return this.factory();
  }

  /**
   * Callers are responsible for resetting fields on obtain rather than release
   * — every spawn path overwrites all of them anyway.
   */
  release(item: T): void {
    this.free.push(item);
  }

  get allocated(): number {
    return this.allocatedCount;
  }

  get available(): number {
    return this.free.length;
  }
}
