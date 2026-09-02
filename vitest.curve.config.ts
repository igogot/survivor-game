import { defineConfig } from 'vitest/config';

/**
 * The spawn-curve probe, run on its own.
 *
 * Like the balance harness it plays full runs and takes minutes, and unlike it
 * this one asserts nothing at all — it prints a table to read before choosing a
 * constant. Keeping it out of `npm test` is the point: a probe that could fail
 * would start being argued with instead of read.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/curve.bench.ts'],
    testTimeout: 30 * 60 * 1000,
  },
});
