import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tmp_build_source/**', 'dist/**', 'node_modules/**'],
  },
});