import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['lib/**/*.ts'], exclude: ['lib/messages.ts', 'lib/types.ts', 'lib/utils.ts'], thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 } },
  },
});

