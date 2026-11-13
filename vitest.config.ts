import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['packages/**/*.test.{ts,tsx}', 'apps/helper/src/**/*.test.{ts,tsx}'],
    setupFiles: ['./packages/app/src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
