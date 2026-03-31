import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
  },
});
