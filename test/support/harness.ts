import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Ledger } from '../../src/engine/ledger.ts'
import { Runner } from '../../src/engine/runner.ts'
import type { WorkflowInput } from '../../src/engine/schema.ts'
import { Store } from '../../src/engine/store.ts'

const open: { root: string; ledger: Ledger }[] = []
afterEach(() => {
  for (const { root, ledger } of open.splice(0)) {
    ledger.db.close()
    if (!root.startsWith(join(tmpdir(), 'ritoko-test-'))) throw new Error('Unsafe test cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * A runner over a temporary home whose browser is a trap: `launched` counts the times a workflow asked for
 * Chrome (a test that expects none fails when the number is not 0). `rows` become the input CSV.
 */
export function harness(rows = 'Email,Name\na@example.test,Ada\nb@example.test,Bob\n', page?: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'ritoko-test-'))
  const ledger = new Ledger(join(root, 'journal.db'))
  open.push({ root, ledger })
  const input = join(root, 'input.csv')
  writeFileSync(input, rows)
  const store = new Store(join(root, 'workflows'))
  const browser = {
    launched: 0,
    async page(): Promise<never> {
      browser.launched++
      if (page) return page as never
      throw new Error('No browser in this test')
    },
  }
  const runner = new Runner(browser, ledger, store, join(root, 'runs'))
  return {
    root,
    input,
    ledger,
    store,
    runner,
    browser,
    save: (workflow: WorkflowInput) => store.save(workflow),
    /** Everything the journal holds, as text: it must contain no secret. */
    dump: () =>
      JSON.stringify(
        ['runs', 'items', 'events'].map((table) => ledger.db.prepare(`SELECT * FROM ${table}`).all()),
      ),
  }
}
