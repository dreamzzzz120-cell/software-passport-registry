import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/security/**/*.test.ts', 'src/trust/**/*.test.ts', 'src/integrations/**/*.test.ts'],
    exclude: ['tmp_build_source/**', 'dist/**', 'node_modules/**'],
  },
});