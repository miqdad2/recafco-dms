import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests: no network, no Docker.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
