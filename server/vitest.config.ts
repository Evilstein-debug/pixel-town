import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests never touch the app database; postgres tests use TEST_DATABASE_URL.
    env: { STORE: 'memory', MOCK_LLM: '1', MOCK_LLM_LATENCY_MS: '0', DATABASE_URL: '' },
    // Postgres-backed files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
