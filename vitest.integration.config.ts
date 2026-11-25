import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts', 'examples/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
