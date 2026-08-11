import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/api.test.ts', 'node_modules/**', 'dist/**'],
    coverage: { reporter: ['text', 'html'] },
  },
});
