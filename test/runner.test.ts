import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { destination } from '../src/engine/download.ts'
import { parseCsv, readItems } from '../src/engine/items.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Runner } from '../src/engine/runner.ts'
import { Workflow, type WorkflowInput } from '../src/engine/schema.ts'
import { check, Store } from '../src/engine/store.ts'
import { api } from './support/api.ts'

const resources: { root: string; ledger: Ledger }[] = []
afterEach(() => {
  for (const { root, ledger } of resources.splice(0)) {
    ledger.db.close()
    if (!root.startsWith(join(tmpdir(), 'ritoko-test-'))) throw new Error('Unsafe test cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})

const target = (css: string) => ({ primary: { by: 'css' as const, css }, fallbacks: [] })

function fakePage() {
  const state = {
    values: new Map<string, string>(),
    absent: new Set<string>(),
    clicks: [] as string[],
    fills: [] as string[],
    uploads: [] as string[],
    url: 'about:blank',
    document: 1,
    failSubmit: false,
    failFill: false,
    failValue: '',
    failUpload: false,
  }
  const locator = (css: string) => ({
    first() {
      return this
    },
    async waitFor() {
      if (state.absent.has(css)) throw new Error('not found')
    },
    async count() {
      return state.absent.has(css) ? 0 : 1
    },
    async fill(value: string) {
      if (state.failFill || value === state.failValue) throw new Error('field unavailable')
      state.fills.push(css)
      state.values.set(css, value)
    },
    async inputValue() {
      return state.values.get(css) ?? ''
    },
    async innerText() {
      return `Created ${state.values.get('#email')}`
    },
    async click(options?: { trial?: boolean }) {
      if (options?.trial) return
      state.clicks.push(css)
      if (state.failSubmit) throw new Error('connection lost after server accepted')
    },
    async setInputFiles(file: string) {
      state.uploads.push(file)
      if (state.failUpload) throw new Error('connection lost after auto-submit')
    },
  })
  const page = {
    locator,
    isClosed: () => false,
    on() {},
    off() {},
    url: () => state.url,
    async goto(url: string) {
      state.url = url
      state.values.clear()
      state.document++
    },
    async evaluate() {
      return state.document
    },
    async screenshot() {},
    async ariaSnapshot() {
      return 'form snapshot'
    },
    async waitForTimeout() {},
  } as unknown as Page
  return { page, state }
}

async function fixture(patch: Partial<WorkflowInput> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ritoko-test-'))
  const ledger = new Ledger(join(root, 'journal.db'))
  resources.push({ root, ledger })
  const input = join(root, 'input.csv')
  writeFileSync(input, 'Email,Name\na@example.test,Ada\nb@example.test,Bob\n')
  const store = new Store(join(root, 'workflows'))
  const { workflow: wf } = await store.save({
    name: 'customers',
    description: 'test',
    params: {
      input: { description: 'csv' },
      account: { description: 'destination', default: 'test' },
    },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: '{{param.account}}' },
    setup: [{ id: 'setup', do: 'goto', url: 'https://example.test/' }],
    item: [
      { id: 'form', do: 'goto', url: 'https://example.test/form' },
      { id: 'email', do: 'fill', target: target('#email'), value: '{{item.Email}}' },
      { id: 'name', do: 'fill', target: target('#name'), value: '{{item.Name}}' },
      { id: 'submit', do: 'click', target: target('#submit'), commit: true },
      { id: 'verify', do: 'expect', target: target('#ok'), text: 'Created {{item.Email}}', timeoutMs: 20 },
    ],
    ...patch,
  })
  const { page, state } = fakePage()
  const runner = new Runner({ page: async () => page }, ledger, store, join(root, 'runs'))
  const start = (account = 'test', repeat = false) => runner.start(wf.name, { input, account }, { repeat })
  const seed = () => {
    const run = ledger.createRun(wf.name, wf.version, { input, account: 'test' }, false, wf, 'test')
    ledger.addItems(run.id, [
      { key: 'a@example.test', data: { Email: 'a@example.test', Name: 'Ada' } },
      { key: 'b@example.test', data: { Email: 'b@example.test', Name: 'Bob' } },
    ])
    ledger.updateRun(run.id, { phase: 'items' })
    return run
  }
  return { root, input, wf, ledger, store, runner, page, state, start, seed }
}

describe('safe batch execution', () => {
  it('retains item credentials only in memory across a post-commit repair on the same document', async () => {
    const site = await api()
    try {
      const f = await fixture({
        setup: [],
        item: [
          { id: 'session', do: 'http', url: `${site.url}/token`, save: { bearer: '/token' } },
          { id: 'form', do: 'goto', url: 'https://example.test/form' },
          { id: 'submit', do: 'click', target: target('#submit'), commit: true },
          { id: 'proof', do: 'expect', target: target('#receipt'), timeoutMs: 20 },
          {
            id: 'api-proof',
            do: 'http',
            url: `${site.url}/orders/receipt`,
            headers: { Authorization: 'Bearer {{vars.bearer}}' },
            expect: { json: { '/status': 'paid' } },
          },
        ],
      })
      f.state.absent.add('#receipt')
      const first = await f.start()
      expect(first.status).toBe('needs_repair')
      expect(f.state.clicks).toHaveLength(1)
      expect(f.ledger.items(first.report.runId)[0]?.vars).toEqual({})
      await f.runner.repair(first.report.runId, 'proof', target('#ok'))
      const done = await f.runner.resume(first.report.runId)
      expect(done.report.counts).toEqual({ done: 2 })
      expect(f.state.clicks).toHaveLength(2)
      expect(site.count('GET', '/token')).toBe(2)
      expect(
        site.seen.filter((r) => r.path === '/orders/receipt').map((r) => r.headers.authorization),
      ).toEqual(['Bearer t-123', 'Bearer t-123'])
      const journal = JSON.stringify(
        ['runs', 'items', 'events'].map((table) => f.ledger.db.prepare(`SELECT * FROM ${table}`).all()),
      )
      expect(journal).not.toContain('t-123')
    } finally {
      await site.close()
    }
  })
  it('holds auto-submit uploads for review after an uncertain transfer', async () => {
    const f = await fixture({
      item: [
        { id: 'file', do: 'upload', target: target('#file'), file: '{{param.input}}', commit: true },
        { id: 'verify', do: 'expect', target: target('#ok') },
      ],
    })
    f.state.failUpload = true
    expect((await f.start()).report.counts).toEqual({ review: 2 })
    expect((await f.start('test', true)).report.counts).toEqual({ review: 2 })
    expect(f.state.uploads).toHaveLength(2)
  })

  it('does not cross the upload boundary for a missing local file', async () => {
    const f = await fixture({
      item: [
        { id: 'file', do: 'upload', target: target('#file'), file: '{{param.input}}.missing', commit: true },
        { id: 'verify', do: 'expect', target: target('#ok') },
      ],
    })
    const result = await f.start()
    expect(result.report.counts).toEqual({ failed: 2 })
    expect(f.ledger.items(result.report.runId).every((i) => !i.committed)).toBe(true)
    expect(f.state.uploads).toHaveLength(0)
  })

  it('adopts the recorded first submission without sending it again', async () => {
    const f = await fixture()
    f.state.values.set('#email', 'a@example.test')
    const adopted = await f.runner.adopt(
      f.wf.name,
      { input: f.input },
      { Email: 'a@example.test', Name: 'Ada' },
      'Recorded first customer and checked the confirmation',
    )
    expect(adopted.status).toBe('done')
    expect(f.state.clicks).toHaveLength(0)
    expect((await f.start()).report.counts).toEqual({ skipped: 1, done: 1 })
    expect(f.state.clicks).toHaveLength(1)
  })

  it('recovers historical done runs that still have pending items', async () => {
    const f = await fixture()
    const run = f.seed()
    f.ledger.updateRun(run.id, { status: 'done' })
    expect((await f.runner.resume(run.id)).report.counts).toEqual({ done: 2 })
    expect(f.state.clicks).toHaveLength(2)
  })

  it('verifies a batch and skips it on a new run', async () => {
    const f = await fixture()
    expect((await f.start()).report.counts).toEqual({ done: 2 })
    expect((await f.start()).report.counts).toEqual({ skipped: 2 })
    expect(f.state.clicks).toEqual(['#submit', '#submit'])
  })

  it('recovers with setup without losing remaining items', async () => {
    const f = await fixture()
    const run = f.seed()
    f.ledger.updateItem(run.id, 0, { status: 'done', committed: true })
    f.ledger.updateItem(run.id, 1, { status: 'running', stepId: 'name' })
    const out = await f.runner.resume(run.id)
    expect(out.status).toBe('done')
    expect(out.report.counts).toEqual({ done: 2 })
    expect(f.state.clicks).toEqual(['#submit'])
  })

  it('freezes the source rows and workflow while a run is interrupted', async () => {
    const f = await fixture()
    const run = f.seed()
    writeFileSync(f.input, 'Email,Name\nother@example.test,Other\n')
    await f.store.save({
      ...f.wf,
      item: f.wf.item.map((s) => (s.id === 'submit' ? { ...s, target: target('#wrong') } : s)),
    })
    expect((await f.runner.resume(run.id)).report.counts).toEqual({ done: 2 })
    expect(f.state.clicks).toEqual(['#submit', '#submit'])
    expect(f.ledger.run(run.id).version).toBe(1)
  })

  it('skips final checks when every row was already done', async () => {
    const f = await fixture({
      teardown: [{ id: 'final', do: 'expect', target: target('#old-result'), timeoutMs: 20 }],
    })
    expect((await f.start()).status).toBe('done')
    // The page no longer shows this run's result: nothing to verify, nothing to repair.
    f.state.absent.add('#old-result')
    const again = await f.start()
    expect(again.status).toBe('done')
    expect(again.report.counts).toEqual({ skipped: 2 })
    expect(again.report.message).toContain('nothing submitted')
    expect(f.state.clicks).toHaveLength(2)
  })

  it('resumes final verification in a new runner without resetting the completed page', async () => {
    const f = await fixture({
      teardown: [
        {
          id: 'final',
          do: 'expect',
          target: target('#old-result'),
          text: 'Created b@example.test',
          timeoutMs: 20,
        },
      ],
    })
    f.state.absent.add('#old-result')
    const paused = await f.start()
    expect(paused.status).toBe('needs_repair')
    expect(paused.report.counts).toEqual({ done: 2 })
    await f.runner.repair(paused.report.runId, 'final', target('#ok'))
    const document = f.state.document
    const cold = new Runner({ page: async () => f.page }, f.ledger, f.store, join(f.root, 'runs'))
    expect((await cold.resume(paused.report.runId)).status).toBe('done')
    expect(f.state.document).toBe(document)
    expect(f.state.clicks).toHaveLength(2)
  })

  it('blocks interrupted commits across runs, including repeat', async () => {
    const f = await fixture()
    const run = f.seed()
    f.ledger.updateItem(run.id, 0, { status: 'running', committed: true, stepId: 'submit' })
    f.ledger.updateItem(run.id, 1, { status: 'done', committed: true })
    expect((await f.runner.resume(run.id)).report.counts).toEqual({ review: 1, done: 1 })
    const next = await f.start('test', true)
    expect(next.status).toBe('partial')
    expect(next.report.counts).toEqual({ review: 1, done: 1 })
    expect(f.state.clicks).toEqual(['#submit'])
  })

  it('marks a post-submit system failure as review', async () => {
    const f = await fixture()
    f.state.failSubmit = true
    const first = await f.start()
    expect(first.status).toBe('partial')
    expect(first.report.counts).toEqual({ review: 2 })
    expect((await f.start()).report.counts).toEqual({ review: 2 })
    expect(f.state.clicks).toHaveLength(2)
  })

  it('treats failed confirmation as unknown, never as safe to retry', async () => {
    const f = await fixture({
      item: [
        { id: 'submit', do: 'click', target: target('#submit'), commit: true },
        { id: 'verify', do: 'expect', text: 'message that never appears', timeoutMs: 1 },
      ],
    })
    expect((await f.start()).report.counts).toEqual({ review: 2 })
    expect((await f.start()).report.counts).toEqual({ review: 2 })
    expect(f.state.clicks).toHaveLength(2)
  })

  it('retries failures before commit from the beginning', async () => {
    const f = await fixture()
    f.state.failFill = true
    const first = await f.start()
    expect(first.report.counts).toEqual({ failed: 2 })
    expect(f.state.clicks).toHaveLength(0)
    f.state.failFill = false
    expect((await f.runner.resume(first.report.runId)).status).toBe('done')
    expect(f.state.clicks).toHaveLength(2)
  })

  it('restarts a paused pre-commit form after its document changed', async () => {
    const f = await fixture()
    f.state.absent.add('#name')
    const first = await f.start()
    expect(first.status).toBe('needs_repair')
    await f.runner.repair(first.report.runId, 'name', target('#new-name'))
    await f.page.goto('https://example.test/new-page')
    expect((await f.runner.resume(first.report.runId)).status).toBe('done')
    expect(f.state.fills.filter((css) => css === '#email')).toHaveLength(3)
    expect(f.state.clicks).toHaveLength(2)
  })

  it('repairs post-commit verification on a live page without another submit', async () => {
    const f = await fixture()
    f.state.absent.add('#ok')
    const first = await f.start()
    expect(first.status).toBe('needs_repair')
    await f.runner.repair(first.report.runId, 'verify', target('#new-ok'))
    expect((await f.runner.resume(first.report.runId)).status).toBe('done')
    expect(f.state.clicks).toHaveLength(2)
  })

  it('publishes successive selector repairs for future runs', async () => {
    const f = await fixture()
    f.state.absent.add('#email')
    f.state.absent.add('#name')
    const first = await f.start()
    await f.runner.repair(first.report.runId, 'email', target('#new-email'))
    const next = await f.runner.resume(first.report.runId)
    expect(next.status).toBe('needs_repair')
    await f.runner.repair(first.report.runId, 'name', target('#new-name'))
    const saved = await f.store.get(f.wf.name)
    expect(saved.item.find((s) => s.id === 'email')).toMatchObject({ target: target('#new-email') })
    expect(saved.item.find((s) => s.id === 'name')).toMatchObject({ target: target('#new-name') })
  })

  it('holds a paused post-commit item for review after losing the document', async () => {
    const f = await fixture()
    f.state.absent.add('#ok')
    const first = await f.start()
    await f.runner.repair(first.report.runId, 'verify', target('#new-ok'))
    await f.page.goto('https://example.test/reloaded')
    const resumed = await f.runner.resume(first.report.runId)
    expect(resumed.report.counts).toEqual({ review: 1, done: 1 })
    expect(resumed.status).toBe('partial')
    expect(f.state.clicks).toHaveLength(2)
  })

  it('pauses only the first submitted item for a missing verification target, then reviews and continues', async () => {
    const f = await fixture({
      item: [
        { id: 'submit', do: 'click', commit: true, target: target('#submit') },
        { id: 'verify', do: 'expect', target: target('#missing'), timeoutMs: 1 },
      ],
    })
    f.state.absent.add('#missing')
    const paused = await f.start()
    expect(paused.status).toBe('needs_repair')
    const resumed = await f.runner.resume(paused.report.runId)
    expect(resumed.status).toBe('partial')
    expect(resumed.report.items.map((i) => [i.status, i.cause])).toEqual([
      ['review', 'verification'],
      ['review', 'verification'],
    ])
    expect(f.state.clicks).toHaveLength(2)
  })

  it('verifies a paused submitted item on its own page before retrying earlier failures', async () => {
    const f = await fixture()
    f.state.failValue = 'a@example.test'
    f.state.absent.add('#ok')
    const paused = await f.start()
    expect(paused.report.counts).toEqual({ failed: 1, paused: 1 })
    f.state.failValue = ''
    await f.runner.repair(paused.report.runId, 'verify', target('#new-ok'))
    expect((await f.runner.resume(paused.report.runId)).report.counts).toEqual({ done: 2 })
    expect(f.state.clicks).toHaveLength(2)
  })

  it('lets other runs process the keys of a run paused before commit, then cancels it', async () => {
    const f = await fixture()
    f.state.absent.add('#name')
    const paused = await f.start()
    expect(paused.status).toBe('needs_repair')
    f.state.absent.delete('#name')
    expect((await f.start()).report.counts).toEqual({ done: 2 })
    const cancelled = await f.runner.cancel(paused.report.runId)
    expect(cancelled.status).toBe('stopped')
    expect(cancelled.items.map((i) => [i.status, i.cause])).toEqual([
      ['failed', 'cancelled'],
      ['failed', 'cancelled'],
    ])
    expect(f.state.clicks).toHaveLength(2)
    // Final: resuming would replay items whose keys other runs may already have processed.
    await expect(f.runner.resume(paused.report.runId)).rejects.toThrow('cancelled for good')
    expect(f.state.clicks).toHaveLength(2)
  })

  it('keeps a paused run repairable after resolving one of its review items', async () => {
    const f = await fixture()
    const run = f.seed()
    f.ledger.updateItem(run.id, 0, { status: 'review', committed: true })
    f.state.absent.add('#name')
    expect((await f.runner.resume(run.id)).status).toBe('needs_repair')
    await f.runner.resolve(run.id, 'a@example.test', 'done', 'Found the customer on the site')
    expect(f.ledger.run(run.id).status).toBe('paused')
    await f.runner.repair(run.id, 'name', target('#new-name'))
    expect((await f.runner.resume(run.id)).status).toBe('done')
  })

  it('never resubmits completed keys after the scope is removed', async () => {
    const f = await fixture()
    await f.start()
    const { warnings } = await f.store.save({
      ...f.wf,
      items: { from: '{{param.input}}', key: '{{item.Email}}' },
    })
    expect(warnings.join()).toMatch('items.scope changed')
    expect((await f.start()).report.counts).toEqual({ skipped: 2 })
    expect(f.state.clicks).toHaveLength(2)
  })

  it('reads secret params from the environment and never journals or echoes them', async () => {
    const f = await fixture({
      params: {
        input: {},
        account: { default: 'test' },
        password: { secret: true, env: 'RITOKO_TEST_SECRET' },
      },
      item: [
        { id: 'password', do: 'fill', target: target('#password'), value: '{{param.password}}' },
        { id: 'submit', do: 'click', target: target('#submit'), commit: true },
        { id: 'verify', do: 'expect', text: 'Welcome {{param.password}}', timeoutMs: 1 },
      ],
    })
    await expect(f.start()).rejects.toThrow('RITOKO_TEST_SECRET')
    await expect(f.runner.start(f.wf.name, { input: f.input, password: 'typed' })).rejects.toThrow('secret')
    process.env.RITOKO_TEST_SECRET = 'hunter2-secret'
    try {
      const result = await f.start()
      expect(f.state.values.get('#password')).toBe('hunter2-secret')
      expect(result.report.items[0]?.message).toContain('Welcome ***')
      expect(JSON.stringify([f.ledger.run(result.report.runId), result])).not.toContain('hunter2')
    } finally {
      delete process.env.RITOKO_TEST_SECRET
    }
  })

  it('confines upload files chosen by item data to the input folder and opens only web URLs', async () => {
    const f = await fixture({
      item: [
        { id: 'file', do: 'upload', target: target('#file'), file: '{{item.File}}', commit: true },
        { id: 'verify', do: 'expect', target: target('#ok') },
      ],
    })
    writeFileSync(join(f.root, 'inside.csv'), 'x')
    writeFileSync(f.input, `Email,File\na@example.test,inside.csv\nb@example.test,${process.execPath}\n`)
    const result = await f.start()
    expect(result.report.items.map((i) => i.status)).toEqual(['done', 'failed'])
    expect(result.report.items[1]?.message).toMatch('must stay inside')
    expect(f.state.uploads).toEqual([realpathSync.native(join(f.root, 'inside.csv'))])
    const local = await fixture({ setup: [{ id: 'setup', do: 'goto', url: 'file:///etc/passwd' }] })
    expect((await local.start()).report.message).toMatch('http(s)')
  })

  it('requires absolute input paths when serving agents', async () => {
    const f = await fixture()
    const strict = new Runner({ page: async () => f.page }, f.ledger, f.store, join(f.root, 'runs'), {
      absolutePaths: true,
    })
    const result = await strict.start(f.wf.name, { input: 'input.csv' })
    expect(result.status).toBe('stopped')
    expect(result.report.message).toMatch('absolute')
  })

  it('reports active time only, without the pause before a resume', async () => {
    const f = await fixture()
    f.state.absent.add('#name')
    const started = Date.now()
    const paused = await f.start()
    const { durationMs } = f.runner.report(paused.report.runId)
    await delay(50)
    expect(f.runner.report(paused.report.runId).durationMs).toBe(durationMs)
    f.state.absent.delete('#name')
    const done = await f.runner.resume(paused.report.runId)
    expect(done.report.durationMs).toBeGreaterThanOrEqual(durationMs)
    expect(done.report.durationMs).toBeLessThanOrEqual(Date.now() - started - 50)
  })

  it('checks target-only expects instead of declaring an absent target successful', async () => {
    const f = await fixture({
      item: [
        { id: 'submit', do: 'click', commit: true, target: target('#submit') },
        { id: 'verify', do: 'expect', target: target('#missing'), timeoutMs: 1 },
      ],
    })
    f.state.absent.add('#missing')
    expect((await f.start()).status).toBe('needs_repair')
  })

  it('resolves original uncertainty and unblocks a duplicate-held run', async () => {
    const f = await fixture()
    const run = f.seed()
    f.ledger.updateItem(run.id, 0, { status: 'review', committed: true })
    f.ledger.updateItem(run.id, 1, { status: 'done', committed: true })
    const blocked = await f.start()
    await expect(f.runner.resolve(blocked.report.runId, 'a@example.test', 'done', 'exists')).rejects.toThrow(
      'original',
    )
    await f.runner.resolve(run.id, 'a@example.test', 'done', 'Matched email and name in customer list')
    expect((await f.runner.resume(blocked.report.runId)).report.counts).toEqual({ skipped: 2 })
    expect(f.state.clicks).toHaveLength(0)
  })

  it('requires evidence before resolving and permits retry only after confirmed non-submission', async () => {
    const f = await fixture()
    const run = f.seed()
    f.ledger.updateItem(run.id, 0, { status: 'review', committed: true })
    await expect(f.runner.resolve(run.id, 'a@example.test', 'failed', '')).rejects.toThrow('note')
    await f.runner.resolve(run.id, 'a@example.test', 'failed', 'No customer with this email on the site')
    expect((await f.runner.resume(run.id)).status).toBe('done')
    expect(f.state.clicks).toHaveLength(2)
  })

  it('separates destinations and refuses conflicting data under the same key', async () => {
    const f = await fixture()
    await f.start('account-a')
    expect((await f.start('account-b')).report.counts).toEqual({ done: 2 })
    writeFileSync(f.input, 'Email,Name\na@example.test,Changed\n')
    expect((await f.start('account-a')).report.counts).toEqual({ failed: 1 })
    expect(f.state.clicks).toHaveLength(4)
  })

  it('validates the complete batch before opening the browser', async () => {
    const f = await fixture()
    writeFileSync(f.input, 'Email,Name\na@example.test,Ada\nb@example.test,\n')
    const result = await f.start()
    expect(result.status).toBe('stopped')
    expect(result.report.message).toMatch(/missing required/)
    expect(f.state.document).toBe(1)
    expect(f.state.clicks).toHaveLength(0)
  })
})

describe('journal and workflow safety', () => {
  it('serializes independent ledger clients and releases failed operations', async () => {
    const f = await fixture()
    const second = new Ledger(join(f.root, 'journal.db'))
    try {
      let release = () => {}
      const held = f.ledger.exclusive(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      await expect(second.exclusive(async () => {})).rejects.toThrow('busy')
      release()
      await held
      await expect(
        second.exclusive(async () => {
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      await expect(f.ledger.exclusive(async () => 'free')).resolves.toBe('free')
    } finally {
      second.db.close()
    }
  })

  it('stops a holder whose lease was taken over, before it writes to the journal', async () => {
    const f = await fixture()
    const run = f.seed()
    await expect(
      f.ledger.exclusive(async () => {
        f.ledger.db.prepare("UPDATE leases SET owner = 'thief' WHERE resource = 'execution'").run()
        f.ledger.updateItem(run.id, 0, { status: 'running' })
      }),
    ).rejects.toThrow('lost its execution lease')
    expect(f.ledger.items(run.id)[0]?.status).toBe('pending')
    // The thief's lease is not released by the stopped holder.
    expect(f.ledger.db.prepare("SELECT owner FROM leases WHERE resource = 'execution'").get()?.owner).toBe(
      'thief',
    )
  })

  it('reclaims a dead process lease', async () => {
    const f = await fixture()
    const lease = f.ledger.db.prepare('INSERT OR REPLACE INTO leases VALUES (?, ?, ?, ?)')
    lease.run('execution', 'dead', 2147483647, Date.now())
    await expect(f.ledger.exclusive(async () => 'recovered')).resolves.toBe('recovered')
    // A live PID whose holder stopped refreshing its heartbeat (hung, or a recycled PID).
    lease.run('execution', 'hung', process.pid, Date.now() - 120_000)
    await expect(f.ledger.exclusive(async () => 'recovered')).resolves.toBe('recovered')
  })

  it('allows 15 minute timeouts only on wait, expect and download', () => {
    const target = { primary: { by: 'role', role: 'button' } }
    const parse = (step: object) => Workflow.parse({ name: 'x', description: 'x', item: [step] })
    for (const step of [
      { do: 'wait', ms: 1, timeoutMs: 900_000 },
      { do: 'expect', text: 'a', timeoutMs: 900_000 },
      { do: 'download', target, saveAs: '{{item.A}}.mp4', timeoutMs: 900_000 },
    ])
      expect(() => parse(step)).not.toThrow()
    expect(() => parse({ do: 'wait', ms: 1, timeoutMs: 900_001 })).toThrow()
    expect(() => parse({ do: 'click', target, timeoutMs: 120_001 })).toThrow()
  })

  it('rejects dangerous workflow shapes and traversal names', async () => {
    const f = await fixture()
    expect(() => check(Workflow.parse({ ...f.wf, item: [{ id: 'empty', do: 'expect' }] }))).toThrow('expect')
    expect(() =>
      check(
        Workflow.parse({
          ...f.wf,
          item: [f.wf.item.find((s) => s.commit), { id: 'empty', do: 'expect', text: ' ' }],
        }),
      ),
    ).toThrow('must not be empty')
    expect(() =>
      check(
        Workflow.parse({
          ...f.wf,
          item: f.wf.item.map((s) => (s.id === 'email' ? { ...s, target: target('{{param.missing}}') } : s)),
        }),
      ),
    ).toThrow('unknown param')
    expect(() =>
      check(
        Workflow.parse({
          ...f.wf,
          item: [...f.wf.item, { id: 'again', do: 'click', target: target('#submit') }],
        }),
      ),
    ).toThrow('after commit')
    await expect(f.store.get('../outside')).rejects.toThrow('Invalid')
  })

  it('assigns missing step ids and explains invalid workflows briefly', async () => {
    const f = await fixture()
    const { workflow } = await f.store.save({
      ...f.wf,
      params: { input: {}, account: { default: 'test' } },
      item: f.wf.item.map(({ id, ...s }) => (id === 'name' ? s : { ...s, id: id === 'form' ? 's1' : id })),
    })
    expect(workflow.item.map((s) => s.id)).toEqual(['s1', 'email', 's2', 'submit', 'verify'])
    await expect(
      f.store.save({ ...f.wf, item: [{ do: 'click', target: { primary: { by: 'role' } } }] }),
    ).rejects.toThrow('Invalid workflow:\n- item[0].target.primary.role: Invalid input')
  })

  it('describes read-only items without referring to a commit', async () => {
    const f = await fixture()
    const readOnly = (item: WorkflowInput['item']) => check(Workflow.parse({ ...f.wf, readOnly: true, item }))
    expect(() => readOnly([{ id: 'open', do: 'goto', url: 'https://example.test/' }])).toThrow(
      'An item needs an expect checking its result',
    )
    expect(
      readOnly([
        { id: 'search', do: 'click', target: { primary: { by: 'role', role: 'button', name: 'Search' } } },
        { id: 'found', do: 'expect', text: 'Results' },
      ]),
    ).toEqual([])
  })

  it('migrates journals created before active time tracking', () => {
    const root = mkdtempSync(join(tmpdir(), 'ritoko-test-'))
    const file = join(root, 'journal.db')
    const legacy = new DatabaseSync(file)
    legacy.exec(`CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow TEXT NOT NULL, version INTEGER NOT NULL,
      params TEXT NOT NULL, files TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'setup', step INTEGER NOT NULL DEFAULT 0,
      repeat INTEGER NOT NULL DEFAULT 0, message TEXT, started_at TEXT NOT NULL, finished_at TEXT)`)
    legacy
      .prepare(
        "INSERT INTO runs (id, workflow, version, params, status, started_at, finished_at) VALUES ('old', 'demo', 1, '{}', 'done', ?, ?)",
      )
      .run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:02.500Z')
    legacy.close()
    const ledger = new Ledger(file)
    resources.push({ root, ledger })
    expect(ledger.run('old').activeMs).toBe(2500)
  })

  it('migrates journals created before saved variables', () => {
    const root = mkdtempSync(join(tmpdir(), 'ritoko-test-'))
    const file = join(root, 'journal.db')
    const legacy = new DatabaseSync(file)
    legacy.exec(`CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow TEXT NOT NULL, version INTEGER NOT NULL,
      params TEXT NOT NULL, files TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'setup', step INTEGER NOT NULL DEFAULT 0,
      repeat INTEGER NOT NULL DEFAULT 0, message TEXT, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE items (
        run_id TEXT NOT NULL REFERENCES runs(id), idx INTEGER NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', step INTEGER NOT NULL DEFAULT 0, committed INTEGER NOT NULL DEFAULT 0,
        cause TEXT, message TEXT, evidence TEXT, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, idx), UNIQUE (run_id, key))`)
    legacy
      .prepare(
        "INSERT INTO runs (id, workflow, version, params, status, started_at) VALUES ('old', 'demo', 1, '{}', 'partial', ?)",
      )
      .run('2026-01-01T00:00:00.000Z')
    legacy
      .prepare(
        "INSERT INTO items (run_id, idx, key, data, status, updated_at) VALUES ('old', 0, 'a', '{}', 'pending', ?)",
      )
      .run('2026-01-01T00:00:00.000Z')
    legacy.close()
    const ledger = new Ledger(file)
    resources.push({ root, ledger })
    expect(ledger.run('old').vars).toEqual({})
    expect(ledger.items('old')[0]?.vars).toEqual({})
    ledger.updateItem('old', 0, { vars: { id: 'o-1' } })
    ledger.updateRun('old', { vars: { token: 't' } })
    expect(ledger.items('old')[0]?.vars).toEqual({ id: 'o-1' })
    expect(ledger.run('old').vars).toEqual({ token: 't' })
  })

  it('keeps remote download names inside the directory and rejects unsafe explicit names', () => {
    const dir = join(tmpdir(), 'downloads')
    const file = destination(dir, undefined, '../../outside.txt')
    expect(dirname(file)).toBe(dir)
    expect(basename(file)).toBe('outside.txt')
    expect(basename(destination(dir, undefined, '..\\outside.txt'))).toBe('outside.txt')
    expect(() => destination(dir, '../outside', 'file.csv')).toThrow('plain filename')
    expect(basename(destination(dir, 'input', 'data.xlsx'))).toBe('input.xlsx')
  })

  it('sanitizes rendered per-item names and numbers collisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ritoko-names-'))
    const name = (saveAs: string, suggested = 'x.mp4') => basename(destination(dir, saveAs, suggested, true))
    expect(name('a/b\\cd:e?.mp4')).toBe('cd_e_.mp4')
    expect(name('CON')).toBe('_CON.mp4')
    expect(name('nul.txt')).toBe('_nul.txt')
    expect(name('clip. . ')).toBe('clip.mp4')
    expect(name('..')).toBe('x.mp4')
    expect(name(`${'a'.repeat(300)}.mp4`)).toHaveLength(120)
    expect(name(`${'a'.repeat(300)}.mp4`).endsWith('.mp4')).toBe(true)
    writeFileSync(join(dir, 'clip.mp4'), '')
    writeFileSync(join(dir, 'clip (2).mp4'), '')
    expect(name('clip')).toBe('clip (3).mp4')
    rmSync(dir, { recursive: true })
  })

  it('rejects malformed CSV and duplicate or blank headers', async () => {
    expect(() => parseCsv('a,b\n"unfinished,b')).toThrow('unclosed')
    expect(() => parseCsv('a,b\n"x"extra,y')).toThrow('closing quote')
    expect(parseCsv('"a; b",c\nx,y')).toEqual([
      ['a; b', 'c'],
      ['x', 'y'],
    ])
    const f = await fixture()
    writeFileSync(f.input, 'Email,Email\na,b\n')
    await expect(readItems(f.input)).rejects.toThrow('duplicate')
    writeFileSync(f.input, 'Email,\na,b\n')
    await expect(readItems(f.input)).rejects.toThrow('empty')
    writeFileSync(f.input, 'Email,Name,\na,b,\n')
    expect(await readItems(f.input)).toEqual([{ Email: 'a', Name: 'b' }])
  })
})
