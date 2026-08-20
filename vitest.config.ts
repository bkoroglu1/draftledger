import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: [
      { find: /^#src\/(.*)$/, replacement: new URL('./src/', import.meta.url).pathname + '$1' },
      { find: /^#seed\/(.*)$/, replacement: new URL('./seed/', import.meta.url).pathname + '$1' },
      // `server-only` is a build-time guard for the Next bundler; under vitest
      // there is no client bundle, so it resolves to a no-op.
      { find: /^server-only$/, replacement: new URL('./tests/stubs/server-only.ts', import.meta.url).pathname },
    ],
  },
});
