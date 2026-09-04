import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', '**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      // node:sqlite is stable enough for us (ADR 0003); keep its banner out of every test run.
      forks: { execArgv: ['--no-warnings=ExperimentalWarning'] },
    },
    environment: 'node',
    server: {
      deps: {
        // Workspace packages resolve to their built `dist/` through symlinks, so vite-node would
        // inline and re-transform them. Its bundled Vite predates `node:sqlite` and fails to
        // resolve it; letting Node load the built packages natively sidesteps that.
        external: [/\/(packages|mcp|apps)\/[^/]+\/dist\//],
      },
    },
  },
});
