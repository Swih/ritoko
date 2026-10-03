import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Host, type HostAction, type HostInput, type HostResponse } from '../src/engine/host.ts'
import type { HostIo } from '../src/engine/host-io.ts'
import { Ledger } from '../src/engine/ledger.ts'
import type { WorkflowInput } from '../src/engine/schema.ts'
import { Store } from '../src/engine/store.ts'

const resources: { root: string; ledger: Ledger }[] = []
afterEach(() => {
  for (const { root, ledger } of resources.splice(0)) {
    ledger.db.close()
    if (!root.startsWith(join(tmpdir(), 'ritoko-host-'))) throw new Error('Unsafe test cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})

type Steps = NonNullable<WorkflowInput['item']>
const label = (text: string) => ({ primary: { by: 'label' as const, text }, fallbacks: [] })
const button = (name: string) => ({ primary: { by: 'role' as const, role: 'button', name }, fallbacks: [] })
const goto = (id: string, path: string) => ({ id, do: 'goto' as const, url: `https://site.test/${path}` })
const fill = { id: 'email', do: 'fill' as const, target: label('Email'), value: '{{item.Email}}' }
const submit = { id: 'submit', do: 'click' as const, target: button('Create'), commit: true }
const verify = { id: 'verify', do: 'expect' as const, text: 'Created {{item.Email}}', timeoutMs: 2000 }
// Steps of the form workflow: 0 goto, 1 email, 2 name, 3 submit (the commit), 4 verify.
const form: Steps = [
  goto('open', 'form'),
  fill,
  { id: 'name', do: 'fill', target: label('Name'), value: '{{item.Name}}' },
  submit,
  verify,
]
const ok = (next: number, sent: number, extra = {}) => ({ ok: true, next, sent, ...extra })
const missed = (at: number, sent: number) => ({
  ok: false,
  at,
  error: 'no element matches',
  selector: true,
  sent,
})

async function setup(patch: Partial<WorkflowInput> = {}, rows = 3, options: { memory?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ritoko-host-'))
  const ledger = new Ledger(options.memory ? ':memory:' : join(root, 'journal.db'))
  resources.push({ root, ledger })
  mkdirSync(join(root, 'inbox'))
  const input = join(root, 'inbox', 'input.csv')
  writeFileSync(
    input,
    `Email,Name,Slug\n${Array.from({ length: rows }, (_, i) => `u${i + 1}@example.test,User ${i + 1},u${i + 1}`).join('\n')}\n`,
  )
  const store = new Store(join(root, 'workflows'))
  await store.save({
    name: 'forms',
    description: 'test',
    params: { input: { description: 'csv' } },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: 'forms' },
    item: form,
    ...patch,
  })
  const pages: { target: string; fragment: string }[] = []
  const clipboard = { text: 'the user text' }
  const io: HostIo = {
    carry: async (batch) => batch.map((page) => `http://127.0.0.1:1/${pages.push(page) - 1}`),
    clipboard: {
      read: () => clipboard.text,
      write: (text) => {
        clipboard.text = text
      },
    },
  }
  const host = new Host(ledger, store, join(root, 'runs'), io)
  const start = (parallel = 1) => host.start('forms', { input }, { parallel })
  const next = (runId: string, input: HostInput = {}) =>
    host.next(runId, {
      batch: JSON.parse(
        String(ledger.db.prepare('SELECT state FROM host_state WHERE run_id = ?').get(runId)?.state),
      ).batch,
      ...input,
    })
  const report = (runId: string) =>
    ledger.items(runId).map((i) => `${i.idx}:${i.status}${i.committed ? '+' : ''}`)
  /** What the nth carry page delivers to the site's page. */
  const delivered = (n: number) =>
    JSON.parse(decodeURIComponent(pages[n]?.fragment ?? '')) as {
      runtime: string
      plan: { steps: { index: number; id: string }[]; token: string; budgetMs: number }
      files: Record<number, string>
    }
  return { root, ledger, store, host, input, pages, clipboard, start, next, report, delivered }
}

const types = (r: HostResponse) => r.actions.map((a) => a.type)
const programs = (r: HostResponse) =>
  r.actions.filter((a): a is Extract<HostAction, { type: 'run_js' }> => a.type === 'run_js')

describe('host mode batches', () => {
  it('processes a thousand API rows without materializing the whole batch for each item', async () => {
    const rows = 1000
    const f = await setup(
      {
        readOnly: true,
        item: [
          {
            id: 'read',
            do: 'http',
            url: 'https://api.example.test/check',
            expect: { status: [200] },
          },
        ],
      },
      rows,
      { memory: true },
    )
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const original = f.ledger.items.bind(f.ledger)
    let materialized = 0
    const reads = vi.spyOn(f.ledger, 'items').mockImplementation((...args) => {
      const values = original(...args)
      materialized += values.length
      return values
    })
    try {
      const done = await f.start()
      expect(done.done?.counts).toEqual({ done: rows })
      expect(request).toHaveBeenCalledTimes(rows)
      expect(f.pages).toEqual([])
      expect(materialized).toBeLessThan(rows * 10)
      const state = JSON.parse(
        String(f.ledger.db.prepare('SELECT state FROM host_state WHERE run_id = ?').get(done.runId)?.state),
      )
      expect(state.cursors).toEqual({})
    } finally {
      request.mockRestore()
      reads.mockRestore()
    }
  })
  it('requires a batch number and refuses malformed or out-of-segment results before changing the journal', async () => {
    const f = await setup({}, 1)
    const first = await f.start()
    await expect(f.host.next(first.runId, { results: [ok(5, 3)] })).rejects.toThrow(/Report batch/)
    for (const result of [
      ok(999, 3),
      ok(5, -1),
      { ok: true, pending: 999, sent: -1, waited: 1 },
      missed(999, -1),
      { ok: 'yes' },
      null,
    ]) {
      await expect(f.next(first.runId, { results: [result] })).rejects.toThrow(/Invalid/)
      expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'running', committed: true })
    }
    expect((await f.next(first.runId, { results: [ok(5, 3)] })).done?.status).toBe('done')
  })

  it('runs at most four lanes and protects concurrent next calls with the ledger lease', async () => {
    const f = await setup({}, 5)
    await expect(f.start(0)).rejects.toThrow(/1 to 4/)
    await expect(f.start(5)).rejects.toThrow(/1 to 4/)
    const first = await f.start(4)
    expect(programs(first).map((p) => p.tab)).toEqual([1, 2, 3, 4])
    const input = { batch: first.batch, results: Array.from({ length: 4 }, () => ok(5, 3)) }
    const attempts = await Promise.allSettled([
      f.host.next(first.runId, input),
      f.host.next(first.runId, input),
    ])
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(f.report(first.runId)).toEqual(['0:done+', '1:done+', '2:done+', '3:done+', '4:running+'])
  })

  it('refuses unsupported setup, teardown, extract, keyboard and iframe plans explicitly', async () => {
    for (const patch of [
      { setup: [goto('setup', 'setup')] },
      { teardown: [goto('teardown', 'teardown')] },
      { item: [...form, { id: 'export', do: 'extract', target: label('Table'), saveAs: 'table.csv' }] },
      {
        item: [goto('open', 'form'), fill, { id: 'enter', do: 'press', key: 'Enter', commit: true }, verify],
      },
      {
        item: [
          goto('open', 'form'),
          { ...fill, target: { ...label('Email'), frame: 'iframe' } },
          submit,
          verify,
        ],
      },
    ] satisfies Partial<WorkflowInput>[]) {
      const f = await setup(patch, 1)
      await expect(f.start()).rejects.toThrow(/Host mode|host mode/)
      expect(f.ledger.lastRun()).toBeUndefined()
    }
  })

  it('uses the frozen workflow after the saved definition changes', async () => {
    const f = await setup({}, 2)
    const first = await f.start()
    const wf = await f.store.get('forms')
    await f.store.save({ ...wf, item: [goto('changed', 'changed'), fill, submit, verify] })
    await f.next(first.runId, { results: [ok(5, 3)] })
    expect(f.pages[1]?.target).toBe('https://site.test/form')
    expect(f.delivered(1).plan.steps.map((s) => s.id)).toEqual(['email', 'name', 'submit', 'verify'])
  })

  it('rejects changed data under a completed business key', async () => {
    const f = await setup({}, 1)
    const first = await f.start()
    await f.next(first.runId, { results: [ok(5, 3)] })
    writeFileSync(f.input, 'Email,Name,Slug\nu1@example.test,Changed name,u1\n')
    const again = await f.start()
    expect(again.done?.counts).toEqual({ failed: 1 })
    expect(f.ledger.items(again.runId)[0]?.message).toContain('different data')
  })

  it('renders names structurally and escapes CSS/XPath item values', async () => {
    const f = await setup(
      {
        item: [
          goto('open', 'form'),
          {
            ...fill,
            target: {
              primary: { by: 'css', css: 'input[data-name="{{item.Name}}"]' },
              fallbacks: [
                { by: 'label', text: '{{item.Name}}' },
                { by: 'xpath', xpath: '//*[@data-name="{{item.Name}}"]' },
              ],
            },
          },
          submit,
          verify,
        ],
      },
      1,
    )
    writeFileSync(f.input, 'Email,Name,Slug\nu1@example.test,"O\'Brien ""quoted""\nnext",u1\n')
    await f.start()
    const target = (
      f.delivered(0).plan.steps[0] as unknown as {
        target: { primary: { css: string }; fallbacks: { text?: string; xpath?: string }[] }
      }
    ).target
    expect(target.fallbacks[0]?.text).toBe('O\'Brien "quoted"\nnext')
    expect(target.primary.css).toContain('\\"quoted\\"\\a next')
    expect(target.fallbacks[1]?.xpath).toContain('concat(')
  })

  it('does not keep a commit marker when the page reports it was still waiting before submission', async () => {
    const f = await setup({}, 1)
    const first = await f.start()
    await f.next(first.runId, { results: [{ ok: true, pending: 3, sent: 2, waited: 100 }] })
    await f.next(first.runId, { results: [missed(3, -1)] })
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'failed', committed: false })
  })
  it('hands out one navigation and one short program per item, with the commit journaled first', async () => {
    const f = await setup()
    const first = await f.start()
    expect(types(first)).toEqual(['navigate', 'run_js'])
    expect(first.actions.map((a) => 'tab' in a && a.tab)).toEqual([1, 1])
    expect(first.actions[0]).toMatchObject({ url: 'http://127.0.0.1:1/0' })
    // The journal says "possibly sent" before the agent holds the program that can send it.
    expect(f.ledger.items(first.runId)[0]).toMatchObject({
      status: 'running',
      committed: true,
      step: 3,
      stepId: 'submit',
    })
    expect(f.pages[0]?.target).toBe('https://site.test/form')
    const { runtime, plan } = f.delivered(0)
    expect(runtime).toContain('hostProgram')
    expect(plan.steps.map((s) => s.index)).toEqual([1, 2, 3, 4])
    const boot = programs(first)[0]?.code ?? ''
    expect(boot.length).toBeLessThan(1100)
    expect(boot).toContain('})(1,')
    expect(boot).not.toContain('hostProgram')
    expect(first.batch).toBe(1)
  })

  it('records a result per program and moves to the next item', async () => {
    const f = await setup()
    const first = await f.start()
    const second = await f.next(first.runId, { batch: 1, results: [ok(5, 3)] })
    expect(f.report(first.runId)).toEqual(['0:done+', '1:running+', '2:pending'])
    expect(types(second)).toEqual(['navigate', 'run_js'])
    expect(second.batch).toBe(2)
    expect(second.note.length).toBeLessThan(first.note.length)
    expect(f.delivered(1).plan.token).not.toBe(f.delivered(0).plan.token)
    // Results may also arrive as the JSON text the page returned.
    const third = await f.next(first.runId, { results: [JSON.stringify(ok(5, 3))] })
    expect(types(third)).toEqual(['navigate', 'run_js'])
    const end = await f.next(first.runId, { results: [ok(5, 3)] })
    expect(end).toMatchObject({ actions: [], done: { status: 'done', counts: { done: 3 } } })
    expect(f.ledger.run(first.runId).status).toBe('done')
  })

  it('refuses the results of another batch', async () => {
    const f = await setup()
    const first = await f.start()
    await f.next(first.runId, { batch: 1, results: [ok(5, 3)] })
    await expect(f.next(first.runId, { batch: 1, results: [ok(5, 3)] })).rejects.toThrow(/current batch is 2/)
  })

  it('keeps an item whose commit was never dispatched retryable', async () => {
    const f = await setup()
    const first = await f.start()
    // The page missed the submit button: sent says no step after the second fill reached the site.
    await f.next(first.runId, { results: [missed(3, 2)] })
    const [item] = f.ledger.items(first.runId)
    expect(item).toMatchObject({ status: 'failed', committed: false, cause: 'selector' })
    expect(item?.message).toContain('submit')
    // The next pass over the same keys processes it again: the duplicate guard does not hold it back.
    const again = await f.start()
    expect(f.report(again.runId)[0]).toBe('0:running+')
  })

  it('holds an item for review when its commit was dispatched and a check failed', async () => {
    const f = await setup()
    const first = await f.start()
    await f.next(first.runId, { results: [missed(4, 3)] })
    expect(f.ledger.items(first.runId)[0]).toMatchObject({
      status: 'review',
      committed: true,
      cause: 'selector',
    })
    // Held for review, the key blocks other runs.
    const again = await f.start()
    expect(f.ledger.items(again.runId)[0]).toMatchObject({ status: 'review', cause: 'duplicate' })
  })

  it('retries a safe failure only when explicitly resuming the terminal run', async () => {
    const f = await setup({}, 1)
    const first = await f.start()
    const done = await f.next(first.runId, { results: [missed(3, 2)] })
    expect(done.done?.counts).toEqual({ failed: 1 })
    expect(done.actions).toEqual([])
    const retry = await f.host.next(first.runId)
    expect(types(retry)).toEqual(['navigate', 'run_js'])
    expect(f.delivered(1).plan.token).not.toBe(f.delivered(0).plan.token)
    expect((await f.next(first.runId, { results: [ok(5, 3)] })).done?.counts).toEqual({ done: 1 })
  })

  it('treats a missing result as an interruption: review after the commit', async () => {
    const f = await setup()
    const first = await f.start()
    const second = await f.next(first.runId)
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'review', cause: 'interrupted' })
    expect(f.report(first.runId)).toEqual(['0:review+', '1:running+', '2:pending'])
    expect(types(second)).toEqual(['navigate', 'run_js'])
  })

  it('journals the commit with the segment that holds it, and restarts an item interrupted before it', async () => {
    const f = await setup({ item: [goto('a', 'a'), fill, goto('b', 'b'), submit, verify] }, 1)
    const first = await f.start()
    expect(f.report(first.runId)).toEqual(['0:running'])
    const restart = await f.next(first.runId)
    expect(f.report(first.runId)).toEqual(['0:running'])
    expect(types(restart)).toEqual(['navigate', 'run_js'])
    expect(f.pages.map((p) => p.target)).toEqual(['https://site.test/a', 'https://site.test/a'])
    // Segment two holds the commit: it is journaled when that program is handed out.
    const second = await f.next(first.runId, { results: [ok(2, 1)] })
    expect(f.report(first.runId)).toEqual(['0:running+'])
    expect(programs(second)[0]?.code).toContain('})(3,')
    await f.next(first.runId)
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'review', cause: 'interrupted' })
  })

  it('clears a commit the stopped batch never reached, and keeps one that may have run', async () => {
    const f = await setup({}, 1)
    const patches: unknown[] = []
    const update = f.ledger.updateItem.bind(f.ledger)
    f.ledger.updateItem = (runId, idx, patch) => {
      patches.push(patch)
      update(runId, idx, patch)
    }
    const first = await f.start()
    // The navigation itself failed: the program after it did not run.
    const retry = await f.next(first.runId, { error: 'navigation failed', completed: 0 })
    expect(patches).toContainEqual({ committed: false })
    expect(types(retry)).toEqual(['navigate', 'run_js'])
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'running', committed: true })
    // The program was the failing action: it may have sent.
    await f.next(first.runId, { error: 'tool timeout', completed: 1 })
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'review', cause: 'interrupted' })
  })

  it('skips the keys a previous run finished', async () => {
    const f = await setup({}, 2)
    const first = await f.start()
    await f.next(first.runId, { results: [ok(5, 3)] })
    await f.next(first.runId, { results: [ok(5, 3)] })
    const again = await f.start()
    expect(again.done).toMatchObject({ status: 'done', counts: { skipped: 2 } })
    expect(again.actions).toEqual([])
  })

  it('never goes on with a cancelled run', async () => {
    const f = await setup()
    const first = await f.start()
    f.ledger.cancel(first.runId)
    const after = await f.next(first.runId, { results: [ok(5, 3)] })
    expect(after.done?.status).toBe('stopped')
    expect(after.actions).toEqual([])
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'review', cause: 'interrupted' })
    expect(f.report(first.runId)).toEqual(['0:review+', '1:failed', '2:failed'])
  })

  it('continues a wait in the same page and falls back to the long form when the boot found nothing', async () => {
    const f = await setup({}, 1)
    const first = await f.start()
    const pending = await f.next(first.runId, {
      results: [{ ok: true, pending: 4, sent: 3, waited: 500 }],
    })
    expect(types(pending)).toEqual(['run_js'])
    expect(programs(pending)[0]?.code).toContain('})(4,')
    const lost = await f.next(first.runId, { results: [{ ok: false, missing: true }] })
    expect(types(lost)).toEqual(['run_js'])
    const code = programs(lost)[0]?.code ?? ''
    expect(code).toContain('__ritokoHost ??= (async function hostProgram')
    const program = JSON.parse(code.slice(code.lastIndexOf('}))(') + 4, -1))
    expect(program.steps.map((s: { index: number }) => s.index)).toEqual([4])
    expect(program.token).toBe(f.delivered(0).plan.token)
    // A page that never keeps the plan ends the item instead of looping.
    await f.next(first.runId, { results: [{ ok: false, missing: true }] })
    await f.next(first.runId, { results: [{ ok: false, missing: true }] })
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'review', cause: 'system' })
  })

  it('gives up on a wait that outlives the step timeout', async () => {
    const f = await setup({}, 1)
    const first = await f.start()
    await f.next(first.runId, { results: [{ ok: true, pending: 4, sent: 3, waited: 1500 }] })
    await f.next(first.runId, { results: [{ ok: true, pending: 4, sent: -1, waited: 1500 }] })
    const [item] = f.ledger.items(first.runId)
    expect(item).toMatchObject({ status: 'review', cause: 'verification' })
    expect(item?.message).toContain('still waiting after 3s')
  })

  it('runs an item that starts without a navigation with the long form', async () => {
    const f = await setup({ item: form.slice(1) }, 1)
    const first = await f.start()
    expect(types(first)).toEqual(['run_js'])
    expect(f.pages).toHaveLength(0)
    expect(programs(first)[0]?.code).toContain('hostProgram')
  })

  it('opens a navigation that has nothing after it, and runs each segment of an item in turn', async () => {
    const f = await setup(
      {
        item: [goto('home', ''), goto('open', 'form'), fill, goto('other', 'check'), verify],
        readOnly: true,
      },
      1,
    )
    const first = await f.start()
    expect(types(first)).toEqual(['navigate', 'navigate', 'run_js'])
    expect(first.actions[0]).toMatchObject({ url: 'https://site.test/' })
    const second = await f.next(first.runId, { results: [ok(3, 2)] })
    expect(f.pages.map((p) => p.target)).toEqual(['https://site.test/form', 'https://site.test/check'])
    expect(types(second)).toEqual(['navigate', 'run_js'])
    expect(programs(second)[0]?.code).toContain('})(4,')
    const end = await f.next(first.runId, { results: [ok(5, 4)] })
    expect(end.done?.status).toBe('done')
  })

  it('applies the defaults of params and refuses secret ones', async () => {
    const f = await setup({
      params: { input: { description: 'csv' }, who: { description: 'x', default: 'me' } },
    })
    const first = await f.host.start('forms', { input: f.input })
    expect(f.ledger.run(first.runId).params).toEqual({ input: f.input, who: 'me' })
    const g = await setup({
      params: { input: { description: 'csv' }, token: { secret: true, env: 'TOKEN' } },
    })
    await expect(g.host.start('forms', { input: g.input })).rejects.toThrow(/secret/)
  })
})

describe('upload files', () => {
  const upload: Steps = [
    goto('open', 'upload'),
    { id: 'pick', do: 'upload', target: label('File'), file: '{{item.File}}', commit: true },
    { id: 'verify', do: 'expect', text: 'Uploaded' },
  ]

  async function uploads(file: (root: string) => string, bytes = 'hello') {
    const f = await setup({ item: upload }, 1)
    mkdirSync(join(f.root, 'inbox', 'sub'))
    writeFileSync(join(f.root, 'inbox', 'sub', 'a.png'), bytes)
    writeFileSync(join(f.root, 'secret.txt'), 'secret')
    writeFileSync(f.input, `Email,File\nu1@example.test,${file(f.root)}\n`)
    return f
  }

  it('carries an upload file in the fragment, only from the folder of the input file', async () => {
    const f = await uploads(() => 'sub/a.png')
    const first = await f.start()
    expect(f.delivered(0).files).toEqual({
      1: `data:image/png;base64,${Buffer.from('hello').toString('base64')}`,
    })
    expect(types(first)).toEqual(['navigate', 'run_js'])
    const outside = await uploads((root) => join(root, 'secret.txt'))
    const refused = await outside.start()
    expect(refused.done?.counts).toEqual({ failed: 1 })
    expect(outside.ledger.items(refused.runId)[0]?.message).toContain('must stay inside')
    expect(outside.pages).toHaveLength(0)
  })

  it('refuses a file too large for the URL, naming it', async () => {
    const f = await uploads(() => 'sub/a.png', 'x'.repeat(1_400_000))
    const first = await f.start()
    expect(first.done?.counts).toEqual({ failed: 1 })
    const [item] = f.ledger.items(first.runId)
    expect(item?.message).toMatch(/a\.png \(1400000 bytes\)/)
    expect(item?.committed).toBe(false)
  })
})

describe('downloads', () => {
  // 0 goto, 1 fill, 2 click (commit), 3 expect, 4 download.
  const generate: Steps = [
    goto('open', 'studio'),
    fill,
    submit,
    { id: 'ready', do: 'expect', text: 'Ready', timeoutMs: 2000 },
    { id: 'save', do: 'download', target: button('Save'), saveAs: '{{item.Slug}}', timeoutMs: 600_000 },
  ]
  const staged = { ok: true, next: 5, sent: 4, staged: { bytes: 4, type: 'image/png' } }
  const payload = (token: string) =>
    `RITOKO|${token}.4|data:image/png;base64,${Buffer.from('PNG!').toString('base64')}`

  it.each(['corrupt payload', 'unwritable folder'])(
    'isolates a %s from the other download lane',
    async (failure) => {
      const f = await setup({ item: generate }, 2)
      const first = await f.start(2)
      const click = await f.next(first.runId, { results: [staged, staged] })
      expect(types(click)).toEqual(['click'])
      let host = f.host
      const blocked = join(f.root, 'blocked')
      if (failure === 'unwritable folder') {
        writeFileSync(blocked, 'This is a file, not a run folder')
        host = new Host(f.ledger, f.store, blocked, f.host.io)
      }
      f.clipboard.text =
        failure === 'corrupt payload'
          ? payload(f.delivered(0).plan.token).replace(
              Buffer.from('PNG!').toString('base64'),
              Buffer.from('BAD').toString('base64'),
            )
          : payload(f.delivered(0).plan.token)
      const next = await host.next(first.runId)
      expect(f.ledger.item(first.runId, 0)).toMatchObject({ status: 'review', cause: 'system' })
      expect(next.actions[0]).toMatchObject({ type: 'click', tab: 2 })
      expect(f.clipboard.text).toBe('the user text')
      if (failure === 'unwritable folder') unlinkSync(blocked)
      f.clipboard.text = payload(f.delivered(1).plan.token)
      const done = await host.next(first.runId)
      expect(done.done).toMatchObject({ status: 'partial', counts: { review: 1, done: 1 } })
      expect(f.clipboard.text).toBe('the user text')
    },
  )

  it('transfers parallel downloads one at a time so no file overwrites another clipboard payload', async () => {
    const f = await setup({ item: generate }, 2)
    const first = await f.start(2)
    const second = await f.next(first.runId, { results: [staged, staged] })
    expect(types(second)).toEqual(['click'])
    expect(second.actions[0]?.tab).toBe(1)
    f.clipboard.text = payload(f.delivered(0).plan.token)
    const third = await f.next(first.runId)
    expect(types(third)).toEqual(['click'])
    expect(third.actions[0]?.tab).toBe(2)
    f.clipboard.text = payload(f.delivered(1).plan.token)
    expect((await f.next(first.runId)).done?.counts).toEqual({ done: 2 })
    expect(f.clipboard.text).toBe('the user text')
    expect(f.ledger.items(first.runId).map((i) => readFileSync(i.evidence ?? '', 'utf8'))).toEqual([
      'PNG!',
      'PNG!',
    ])
  })

  it('continues after one download to save a second file for the same item', async () => {
    const f = await setup(
      {
        item: [
          ...generate,
          { id: 'save2', do: 'download', target: button('Save'), saveAs: '{{item.Slug}}-second.png' },
        ],
      },
      1,
    )
    const first = await f.start()
    await f.next(first.runId, { results: [staged] })
    f.clipboard.text = payload(f.delivered(0).plan.token)
    const next = await f.next(first.runId)
    expect(types(next)).toEqual(['run_js'])
    await f.next(first.runId, { results: [{ ...staged, next: 6, sent: 5 }] })
    f.clipboard.text = payload(f.delivered(0).plan.token).replace('.4|', '.5|')
    const done = await f.next(first.runId)
    expect(done.done?.status).toBe('done')
    expect(Object.keys(done.done?.files ?? {})).toEqual(['u1.png', 'save', 'u1-second.png', 'save2'])
  })

  it('preserves new clipboard text if the user changes it during a handoff', async () => {
    const f = await setup({ item: generate }, 1)
    const first = await f.start()
    await f.next(first.runId, { results: [staged] })
    f.clipboard.text = 'new text copied by the user'
    await f.next(first.runId)
    expect(f.clipboard.text).toBe('new text copied by the user')
  })

  it('clicks the shield, starts the next item in the same batch and takes the file at the next call', async () => {
    const f = await setup({ item: generate }, 2)
    const first = await f.start()
    const second = await f.next(first.runId, { results: [staged] })
    expect(types(second)).toEqual(['click', 'navigate', 'run_js'])
    expect(second.actions[0]).toEqual({ type: 'click', tab: 1, x: 200, y: 200 })
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'running' })
    // The agent's click copied the file over the user's text, which was noted before it.
    f.clipboard.text = payload(f.delivered(0).plan.token)
    const third = await f.next(first.runId, { results: [staged] })
    expect(f.clipboard.text).toBe('the user text')
    const [item] = f.ledger.items(first.runId)
    expect(item).toMatchObject({ status: 'done' })
    expect(readFileSync(item?.evidence as string, 'utf8')).toBe('PNG!')
    expect(item?.evidence).toMatch(/u1\.png$/)
    expect(Object.keys(f.ledger.run(first.runId).files)).toEqual(['u1.png', 'save'])
    expect(types(third)).toEqual(['click'])
    f.clipboard.text = payload(f.delivered(1).plan.token)
    const end = await f.next(first.runId)
    expect(end.done).toMatchObject({ status: 'done', counts: { done: 2 } })
    expect(existsSync(f.ledger.items(first.runId)[1]?.evidence as string)).toBe(true)
    expect(f.clipboard.text).toBe('the user text')
  })

  it('asks for the click again while the page is there, then holds the item for review', async () => {
    const f = await setup({ item: generate }, 1)
    const first = await f.start()
    expect(types(await f.next(first.runId, { results: [staged] }))).toEqual(['click'])
    expect(types(await f.next(first.runId))).toEqual(['click'])
    expect(types(await f.next(first.runId))).toEqual(['click'])
    const last = await f.next(first.runId)
    expect(last.done?.counts).toEqual({ review: 1 })
    expect(f.ledger.items(first.runId)[0]?.message).toContain('hand-off')
    expect(f.clipboard.text).toBe('the user text')
  })

  it('holds the item for review when its page was left before the file arrived', async () => {
    const f = await setup({ item: generate }, 2)
    const first = await f.start()
    await f.next(first.runId, { results: [staged] })
    await f.next(first.runId, { results: [missed(3, 2)] })
    expect(f.ledger.items(first.runId)[0]).toMatchObject({ status: 'review', committed: true })
  })
})
