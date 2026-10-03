import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { destination } from '../src/engine/download.ts'
import { parseCsv, readItems } from '../src/engine/items.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Runner } from '../src/engine/runner.ts'
import { Workflow, type WorkflowInput } from '../src/engine/schema.ts'
import { check, Store } from '../src/engine/store.ts'

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
      if (state.failFill) throw new Error('field unavailable')
      state.fills.push(css)
      state.values.set(css, value)
    },
    async inputValue() {
      return state.values.get(css) ?? ''
    },
    async innerText() {
      return `Created ${state.values.get('#email')}`
    },
    async click() {
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

  it('reclaims a dead process lease', async () => {
    const f = await fixture()
    f.ledger.db.prepare('INSERT INTO leases VALUES (?, ?, ?)').run('execution', 'dead', 2147483647)
    await expect(f.ledger.exclusive(async () => 'recovered')).resolves.toBe('recovered')
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

  it('keeps remote download names inside the directory and rejects unsafe explicit names', () => {
    const dir = join(tmpdir(), 'downloads')
    const file = destination(dir, undefined, '../../outside.txt')
    expect(dirname(file)).toBe(dir)
    expect(basename(file)).toMatch(/-outside\.txt$/)
    expect(basename(destination(dir, undefined, '..\\outside.txt'))).toMatch(/-outside\.txt$/)
    expect(() => destination(dir, '../outside', 'file.csv')).toThrow('plain filename')
    expect(destination(dir, 'input', 'data.xlsx')).toMatch(/-input\.xlsx$/)
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
  })
})
