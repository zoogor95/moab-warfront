import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts'],
    testTimeout: 60_000,
    // `npm run test:db` runs in mode "db": database suites must run, not skip. Set here rather
    // than as `REQUIRE_DB=1 npm test` so the script works in PowerShell and cmd too.
    env: mode === 'db' ? { REQUIRE_DB: '1' } : {},
  },
}));
