import { defineConfig } from 'vitest/config';

/**
 * Forty-minute runs. Slower than the balance stand and run for the same reason:
 * after touching anything that shapes the late game — a spawn curve, the boss
 * cycle, an enemy that only appears after minute five.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/endless.bench.ts'],
    testTimeout: 60 * 60 * 1000,
  },
});
