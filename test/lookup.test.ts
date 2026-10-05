import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { Host } from '../src/engine/host.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Runner } from '../src/engine/runner.ts'
import type { WorkflowInput } from '../src/engine/schema.ts'
import { harness } from './support/harness.ts'

const close: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of close.splice(0)) await fn()
})

async function fixture() {
  const f = harness('Email,Name\na@example.test,Ada\n')
  const state = { status: 200, body: { found: false } as unknown, reads: 0, writes: 0, hang: false }
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      state.reads++
      res.writeHead(state.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(state.body))
    } else {
      state.writes++
      state.body = { found: true, email: 'a@example.test', name: 'Ada' }
      for await (const _ of req) {
        /* consume body */
      }
      if (!state.hang) {
        res.writeHead(201)
        res.end('{}')
      }
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  close.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  })
  const wf: WorkflowInput & {
    ensure: NonNullable<WorkflowInput['ensure']>
    params: { input: object; base: { default: string } }
  } = {
    name: 'ensured',
    description: 'Verified lookup',
    params: { input: {}, base: { default: `http://127.0.0.1:${address.port}` } },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: '{{param.base}}' },
    ensure: {
      read: { do: 'http', url: '{{param.base}}/lookup', query: { email: '{{item.Email}}' } },
      present: { json: { '/found': 'true', '/email': '{{item.Email}}', '/name': '{{item.Name}}' } },
      absent: { json: { '/found': 'false' } },
    },
    item: [
      {
        do: 'http',
        method: 'POST',
        url: '{{param.base}}/create',
        commit: true,
        timeoutMs: 150,
        expect: { status: [201] },
      },
    ],
  }
  await f.save(wf)
  return { ...f, state, wf, start: () => f.runner.start(wf.name, { input: f.input }) }
}

test('ensure verifies an existing record and never submits; provenance survives reopening', async () => {
  const f = await fixture()
  f.state.body = { found: true, email: 'a@example.test', name: 'Ada', token: 'response-secret' }
  const result = await f.start()
  expect(result.report.counts).toEqual({ done: 1 })
  expect(result.report.items[0]?.resolution).toMatchObject({ by: 'ensure', verified: true })
  expect(f.state.writes).toBe(0)
  expect(f.dump()).not.toContain('response-secret')
  const reopened = new Ledger(join(f.root, 'journal.db'))
  try {
    expect(reopened.item(result.report.runId, 0).resolution?.verified).toBe(true)
  } finally {
    reopened.db.close()
  }
})

test('adoption requires actual readback even when the commit alone normally verifies the item', async () => {
  const f = await fixture()
  await f.save({ ...f.wf, ensure: undefined })
  const data = { Email: 'a@example.test', Name: 'Ada' }
  await expect(f.runner.adopt('ensured', { input: f.input }, data, 'Recorded')).rejects.toThrow(
    /Adoption needs/,
  )
  await f.save(f.wf)
  f.state.body = { found: true, email: data.Email, name: data.Name }
  const result = await f.runner.adopt('ensured', { input: f.input }, data, 'Recorded')
  expect(result.report.items[0]).toMatchObject({
    status: 'done',
    resolution: { by: 'ensure', verified: true },
  })
  expect(f.state.writes).toBe(0)
})

test('reconcile reads an interrupted commit directly and needs current credentials before reading', async () => {
  const f = await fixture()
  const saved = await f.save({
    ...f.wf,
    params: { ...f.wf.params, token: { secret: true, env: 'RITOKO_LOOKUP_TEST_TOKEN' } },
    ensure: {
      ...f.wf.ensure,
      read: {
        do: 'http',
        url: '{{param.base}}/lookup',
        query: { email: '{{item.Email}}' },
        headers: { Authorization: 'Bearer {{param.token}}' },
      },
    },
  })
  const run = f.ledger.createRun(
    'ensured',
    saved.workflow.version,
    { input: f.input, base: f.wf.params.base.default },
    false,
    saved.workflow,
    f.wf.params.base.default,
  )
  f.ledger.addItems(run.id, [{ key: 'a@example.test', data: { Email: 'a@example.test', Name: 'Ada' } }])
  f.ledger.updateItem(run.id, 0, { status: 'running', committed: true })
  const previous = process.env.RITOKO_LOOKUP_TEST_TOKEN
  delete process.env.RITOKO_LOOKUP_TEST_TOKEN
  try {
    await expect(f.runner.reconcile(run.id, 'a@example.test')).rejects.toThrow(/environment/)
    expect(f.state.reads).toBe(0)
    expect(f.ledger.item(run.id, 0).status).toBe('running')
    process.env.RITOKO_LOOKUP_TEST_TOKEN = 'lookup-secret-value'
    f.state.body = { found: true, email: 'a@example.test', name: 'Ada' }
    expect((await f.runner.reconcile(run.id, 'a@example.test')).counts).toEqual({ done: 1 })
    expect(f.dump()).not.toContain('lookup-secret-value')
    expect(f.state.writes).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.RITOKO_LOOKUP_TEST_TOKEN
    else process.env.RITOKO_LOOKUP_TEST_TOKEN = previous
  }
})

test.each([
  [200, {}],
  [200, { found: true, email: 'other', name: 'Ada' }],
  [401, { found: false }],
  [404, { found: false }],
  [500, { found: false }],
  [302, { found: false }],
])('ensure fails closed on HTTP %s or missing/conflicting evidence', async (status, body) => {
  const f = await fixture()
  f.state.status = status as number
  f.state.body = body
  expect((await f.start()).report.counts).toEqual({ failed: 1 })
  expect(f.state.writes).toBe(0)
  expect(f.state.reads).toBe(1)
})

test('explicit configured 404 JSON absence permits the first write', async () => {
  const f = await fixture()
  f.wf.ensure.absent.status = [404]
  await f.save(f.wf)
  f.state.status = 404
  expect((await f.start()).status).toBe('done')
  expect(f.state.writes).toBe(1)
})

test('ambiguous presence and absence never submit', async () => {
  const f = await fixture()
  f.wf.ensure.absent = { json: { '/found': 'true' } }
  await f.save(f.wf)
  f.state.body = { found: true, email: 'a@example.test', name: 'Ada' }
  expect((await f.start()).report.items[0]?.message).toContain('inconclusive')
  expect(f.state.writes).toBe(0)
})

test('accepted write with lost response is reconciled after restart from frozen workflow and input', async () => {
  const f = await fixture()
  f.state.hang = true
  const result = await f.start()
  expect(result.report.counts).toEqual({ review: 1 })
  writeFileSync(f.input, 'Email,Name\nchanged@example.test,Changed\n')
  await f.save({ ...f.wf, ensure: undefined })
  const reopened = new Ledger(join(f.root, 'journal.db'))
  const runner = new Runner(f.browser, reopened, f.store, join(f.root, 'runs'))
  try {
    const report = await runner.reconcile(result.report.runId, 'a@example.test')
    expect(report.items[0]).toMatchObject({ status: 'done', resolution: { by: 'reconcile', verified: true } })
    expect((await runner.resume(report.runId)).status).toBe('done')
    expect(reopened.events(report.runId, 'resolve')).toHaveLength(1)
    expect(f.state.writes).toBe(1)
    expect(f.browser.launched).toBe(0)
  } finally {
    reopened.db.close()
  }
})

test('reconcile errors preserve review; absence releases only for later explicit resume', async () => {
  const f = await fixture()
  f.state.hang = true
  const id = (await f.start()).report.runId
  f.state.status = 401
  f.state.body = { found: false }
  await expect(f.runner.reconcile(id, 'a@example.test')).rejects.toThrow(/401/)
  expect(f.ledger.item(id, 0).status).toBe('review')
  f.state.status = 200
  const report = await f.runner.reconcile(id, 'a@example.test')
  expect(report.items[0]).toMatchObject({ status: 'failed', resolution: { by: 'reconcile', verified: true } })
  expect(f.ledger.item(id, 0).committed).toBe(false)
  expect(f.state.writes).toBe(1)
  f.state.hang = false
  expect((await f.runner.resume(id)).status).toBe('done')
  expect(f.state.writes).toBe(2)
  // Includes durable start, two reconciliations and resume on slow Windows CI storage.
}, 30_000)

test('busy and duplicate barriers prevent lookup; cancelled reconciliation never reopens the run', async () => {
  const f = await fixture()
  f.state.hang = true
  const id = (await f.start()).report.runId
  const duplicate = await f.start()
  const reads = f.state.reads
  await expect(f.runner.reconcile(duplicate.report.runId, 'a@example.test')).rejects.toThrow(/original/)
  await f.ledger.exclusive(async () => {
    await expect(f.runner.reconcile(id, 'a@example.test')).rejects.toThrow(/busy/)
  })
  expect(f.state.reads).toBe(reads)
  await f.runner.cancel(id)
  await f.runner.reconcile(id, 'a@example.test')
  expect(f.ledger.run(id).status).toBe('stopped')
  await expect(f.runner.resume(id)).rejects.toThrow(/cancelled/)
  expect(f.state.writes).toBe(1)
})

test('host and unsafe declarative lookups are refused', async () => {
  const f = await fixture()
  const host = new Host(f.ledger, f.store, join(f.root, 'runs'))
  try {
    await expect(host.start('ensured', { input: f.input })).rejects.toThrow(/direct runner/)
  } finally {
    await host.close()
  }
  for (const read of [
    { do: 'http', method: 'POST', url: '{{param.base}}' },
    { do: 'http', url: '{{param.base}}', session: 'browser' },
    { do: 'http', url: '{{param.base}}', query: { email: '{{vars.email}}' } },
  ])
    await expect(f.store.save({ ...f.wf, ensure: { ...f.wf.ensure, read } })).rejects.toThrow(/ensure/)
  await expect(
    f.save({ ...f.wf, ensure: { ...f.wf.ensure, present: { json: { '/found': 'true' } } } }),
  ).rejects.toThrow(/business key/)
})

test.each(['lookup', 'echo'])('MCP lookup %s requires a positive readOnlyHint', async (tool) => {
  const f = await fixture()
  f.wf.servers = {
    fixture: {
      command: process.execPath,
      args: [fileURLToPath(new URL('./support/mcp-fixture.ts', import.meta.url))],
    },
  }
  f.wf.ensure = {
    read: { do: 'mcp', server: 'fixture', tool, readOnly: true, args: { message: '{{item.Email}}' } },
    present: { json: { '/echo': '{{item.Email}}' } },
    absent: { json: { '/found': 'false' } },
  }
  await f.save(f.wf)
  const result = await f.start()
  expect(result.report.counts).toEqual(tool === 'lookup' ? { done: 1 } : { failed: 1 })
  expect(f.state.writes).toBe(0)
})
