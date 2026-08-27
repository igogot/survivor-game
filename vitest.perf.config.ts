import { defineConfig } from 'vitest/config';

/**
 * The performance harness runs separately from `npm test`, for the same reason
 * the balance one does: it takes minutes.
 *
 * It also has a requirement the other configs do not — nothing else may run
 * beside it. Vitest spreads files across workers by default, and a second
 * worker competing for a core turns a tick-time percentile into a measurement
 * of the machine's scheduler.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/perf.bench.ts'],
    testTimeout: 30 * 60 * 1000,
    fileParallelism: false,
    maxConcurrency: 1,
    poolOptions: {
      forks: { singleFork: true },
      threads: { singleThread: true },
    },
  },
});
