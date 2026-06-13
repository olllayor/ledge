import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'convex/**/*.test.ts'],
    environment: 'node',
    // Most tests run in node (main process, shared, convex). Renderer
    // hook/component tests that touch the DOM opt into happy-dom via a
    // per-file pragma (`// @vitest-environment happy-dom`).
  },
})
