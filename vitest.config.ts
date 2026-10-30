import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The Postgres suites run against the SHARED dev database — parallel
    // test files would insert/delete rows under each other's exact-count
    // assertions. Files run sequentially (the whole suite is a few
    // seconds).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
