import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests against the isolated dev stack (deploy/dev) and a
// production build of the portal started on port 3107.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 240_000,
    hookTimeout: 300_000,
    reporters: ['verbose'],
  },
});
