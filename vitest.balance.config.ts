import { defineConfig } from 'vitest/config';

/**
 * The balance harness runs separately from `npm test`.
 *
 * It plays full ten-minute runs and takes minutes, which is the wrong thing to
 * put in front of a commit — but the right thing to run after touching a spawn
 * curve, a weapon number or the upgrade table.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/balance.bench.ts'],
    testTimeout: 30 * 60 * 1000,
  },
});
