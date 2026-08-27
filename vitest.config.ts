import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The simulation never touches Pixi or the DOM, so the tests run in plain
    // Node. That constraint is the whole point of the render/logic split.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
