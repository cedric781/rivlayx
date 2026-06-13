import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/lib/**/*.test.ts',
      'apps/*/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts', 'apps/*/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
