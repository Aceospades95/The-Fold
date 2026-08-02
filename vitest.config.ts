import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@fold/shared', replacement: fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) },
      // Server sources use NodeNext-style ".js" specifiers; map them back to .ts for vite-node.
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
    ],
  },
  test: {
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts'],
  },
})
