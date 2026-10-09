import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { runDemo } from './demo.mjs'

const result = await runDemo({ log: () => {} })
try {
  assert.deepEqual(result.first.counts, { done: 10 })
  assert.deepEqual(result.rerun.counts, { skipped: 10 })
  assert.deepEqual(result.stats, { writes: 10, unique: 10, reads: 10 })
  console.log('First-run smoke passed: compiled CLI, 10 readbacks, 10 skips, no extra writes.')
} finally {
  await rm(result.home, { recursive: true, force: true })
}
