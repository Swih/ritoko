import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'threads',
    include: ['test/e2e.test.ts'],
    maxWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
})
