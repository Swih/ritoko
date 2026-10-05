import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pointer } from '../src/engine/integrations.ts'
import type { WorkflowInput } from '../src/engine/schema.ts'
import { api } from './support/api.ts'
import { harness } from './support/harness.ts'

const SECRET = 'sekret-token-xyz'
const sites: { close: () => Promise<void> }[] = []
beforeEach(() => {
  process.env.RITOKO_TEST_API_KEY = SECRET
})
afterEach(async () => {
  delete process.env.RITOKO_TEST_API_KEY
  for (const site of sites.splice(0)) await site.close()
})
async function serve() {
  const site = await api()
  sites.push(site)
  return site
}

const ONE = 'Email\na@example.test\n'

/** A batch of rows (two by default) sent to the test API. */
async function fixture(site: Awaited<ReturnType<typeof api>>, steps: Partial<WorkflowInput>, rows?: string) {
  const f = harness(rows)
  const { workflow: wf } = await f.save({
    name: 'orders',
    description: 'test',
    params: { input: {}, base: { default: site.url }, key: { secret: true, env: 'RITOKO_TEST_API_KEY' } },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: '{{param.base}}' },
    ...steps,
  })
  return { ...f, wf, start: () => f.runner.start(wf.name, { input: f.input }) }
}

const login = {
  id: 'login',
  do: 'http' as const,
  url: '{{param.base}}/token',
  headers: { Authorization: 'Bearer {{param.key}}' },
  save: { session: '/token' },
}
const create = {
  id: 'create',
  do: 'http' as const,
  method: 'POST' as const,
  url: '{{param.base}}/orders',
  body: { json: { email: '{{item.Email}}' } },
  commit: true,
  expect: { status: [201] },
  save: { orderId: '/id' },
}
const verify = {
  id: 'verify',
  do: 'http' as const,
  url: '{{param.base}}/orders/{{vars.orderId}}',
  expect: { json: { '/status': 'paid' } },
}

describe('http steps', () => {
  it('chains saved values into later steps, journals them and never opens Chrome', async () => {
    const site = await serve()
    const authed = { ...create, headers: { Authorization: 'Bearer {{vars.session}}' } }
    const f = await fixture(site, { setup: [login], item: [authed, verify] })
    const done = await f.start()
    expect(done.status).toBe('done')
    expect(done.report.counts).toEqual({ done: 2 })
    expect(f.browser.launched).toBe(0)
    // The secret param went out in the header; a value saved by setup fed every item's header.
    expect(site.seen[0]?.headers.authorization).toBe(`Bearer ${SECRET}`)
    const orders = site.seen.filter((r) => r.path === '/orders')
    expect(orders.map((r) => r.headers.authorization)).toEqual(['Bearer t-123', 'Bearer t-123'])
    expect(orders.map((r) => JSON.parse(r.body))).toEqual([
      { email: 'a@example.test' },
      { email: 'b@example.test' },
    ])
    expect(orders[0]?.headers['content-type']).toBe('application/json')
    expect(site.count('GET', '/orders/o-1')).toBe(1)
    // Variables live in the journal: the setup's on the run, each item's own on the item.
    expect(f.ledger.run(done.report.runId).vars).toEqual({})
    expect(f.dump().includes('t-123')).toBe(false)
    expect(f.ledger.items(done.report.runId).map((i) => i.vars.orderId)).toEqual(['o-1', 'o-2'])
    // The journal events carry no body and no secret.
    const events = f.ledger.db.prepare("SELECT detail FROM events WHERE kind = 'http'").all()
    expect(events).toHaveLength(5)
    expect(JSON.parse(String(events[1]?.detail))).toEqual({
      item: 'a@example.test',
      step: 'create',
      method: 'POST',
      url: `${site.url}/orders`,
      status: 201,
      saved: ['orderId'],
    })
    expect(f.dump()).not.toContain(SECRET)
    // The duplicate guard covers API items like any other.
    expect((await f.start()).report.counts).toEqual({ skipped: 2 })
    expect(site.count('POST', '/orders')).toBe(2)
  })

  it('masks secrets in failures, even when the server echoes them', async () => {
    const site = await serve()
    const leak = {
      ...create,
      id: 'leak',
      url: '{{param.base}}/leak',
      headers: { Authorization: 'Bearer {{param.key}}' },
    }
    const f = await fixture(site, { item: [leak, verify] })
    const result = await f.start()
    expect(result.report.counts).toEqual({ review: 2 })
    expect(result.report.items[0]?.message).toContain('answered 500')
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(f.dump()).not.toContain(SECRET)
  })

  it('checks the status: 2xx unless the step says otherwise', async () => {
    const site = await serve()
    const missing = {
      id: 'missing',
      do: 'http' as const,
      url: '{{param.base}}/nothing',
      expect: { json: { '/error': 'not found' } },
    }
    const f = await fixture(site, { item: [missing], readOnly: true })
    expect((await f.start()).report.items[0]?.message).toContain('answered 404')
    const expected = { ...missing, expect: { status: [404], json: { '/error': 'not found' } } }
    const g = await fixture(site, { item: [expected], readOnly: true })
    expect((await g.start()).report.counts).toEqual({ done: 2 })
  })

  it('retries a GET on a transient status but never a POST', async () => {
    const site = await serve()
    const flaky = {
      id: 'flaky',
      do: 'http' as const,
      url: '{{param.base}}/flaky',
      expect: { json: { '/ok': 'true' } },
    }
    const f = await fixture(site, { item: [flaky], readOnly: true }, ONE)
    expect((await f.start()).report.counts).toEqual({ done: 1 })
    expect(site.count('GET', '/flaky')).toBe(3)
    // A POST before the commit is refused: otherwise resuming the item would replay a write.
    const post = { ...create, id: 'post', commit: false, url: '{{param.base}}/flaky' }
    await expect(fixture(site, { item: [post, create] })).rejects.toThrow("must be the item's commit")
    expect(site.count('POST', '/flaky')).toBe(0)
    // The commit is never sent twice either: an answered failure leaves the item for review.
    const h = await fixture(site, { item: [{ ...post, id: 'commit', commit: true }] }, ONE)
    expect((await h.start()).report.counts).toEqual({ review: 1 })
    expect(site.count('POST', '/flaky')).toBe(1)
  })

  it('fails a timeout before the commit as retryable, and holds one after it for review', async () => {
    const site = await serve()
    const wait = { id: 'wait', do: 'http' as const, url: '{{param.base}}/hang', timeoutMs: 150 }
    const before = await fixture(site, { item: [wait, create, verify] }, ONE)
    const first = await before.start()
    expect(first.report.items[0]).toMatchObject({ status: 'failed', cause: 'system' })
    expect(first.report.items[0]?.message).toContain('No answer within 0.15 s')
    expect(before.ledger.items(first.report.runId)[0]?.committed).toBe(false)
    expect(site.count('POST', '/orders')).toBe(0)
    // Safe to run again: resume sends the item from its start.
    expect((await before.runner.resume(first.report.runId)).report.counts).toEqual({ failed: 1 })
    expect(site.count('GET', '/hang')).toBe(2)

    const send = { ...create, id: 'send', url: '{{param.base}}/hang', timeoutMs: 150 }
    const after = await fixture(site, { item: [send, verify] }, ONE)
    const second = await after.start()
    expect(second.report.items[0]).toMatchObject({ status: 'review', cause: 'system' })
    expect(after.ledger.items(second.report.runId)[0]?.committed).toBe(true)
    // Never sent again: a committed item waits for a person.
    expect((await after.runner.resume(second.report.runId)).report.counts).toEqual({ review: 1 })
    expect(site.count('POST', '/hang')).toBe(1)
  })

  it('never retries GET verification after a commit, even on a transient response', async () => {
    const site = await serve()
    const f = await fixture(site, { item: [create, { ...verify, url: '{{param.base}}/flaky' }] }, ONE)
    const result = await f.start()
    expect(result.report.counts).toEqual({ review: 1 })
    expect(site.count('POST', '/orders')).toBe(1)
    expect(site.count('GET', '/flaky')).toBe(1)
  })

  it('forgets the prior row variables and saves only variables from the current item', async () => {
    const site = await serve()
    const f = await fixture(site, {
      setup: [{ ...login, save: { number: '/nested/n' } }],
      item: [
        {
          ...verify,
          id: 'read',
          url: '{{param.base}}/vary',
          expect: { status: [200] },
          save: { rowId: '/id' },
        },
        create,
      ],
    })
    const result = await f.start()
    expect(result.report.items.map((item) => item.status)).toEqual(['done', 'failed'])
    expect(site.count('POST', '/orders')).toBe(1)
    expect(f.ledger.run(result.report.runId).vars).toEqual({ number: '5' })
    expect(f.ledger.items(result.report.runId).map((item) => item.vars)).toEqual([
      { rowId: 'first', orderId: 'o-1' },
      {},
    ])
  })

  it('changes the idempotency key for an explicit repeat while retaining it across resume', async () => {
    const site = await serve()
    const f = await fixture(site, { item: [{ ...create, idempotencyKey: true }] }, ONE)
    expect((await f.start()).status).toBe('done')
    expect((await f.runner.start(f.wf.name, { input: f.input }, { repeat: true })).status).toBe('done')
    const keys = site.seen
      .filter((request) => request.method === 'POST')
      .map((request) => request.headers['idempotency-key'])
    expect(new Set(keys).size).toBe(2)
  })

  it('keeps the same Idempotency-Key when an item is sent again after a person cleared it', async () => {
    const site = await serve()
    const once = {
      ...create,
      url: '{{param.base}}/once',
      idempotencyKey: true,
      timeoutMs: 150,
      save: undefined,
    }
    const check = { ...verify, url: '{{param.base}}/orders/once' }
    const f = await fixture(site, { item: [once, check] }, 'Email\na@example.test\nb@example.test\n')
    const first = await f.start()
    expect(first.report.counts).toEqual({ review: 2 })
    for (const { key } of first.report.items)
      await f.runner.resolve(first.report.runId, key, 'failed', 'Not in the shop', { confirmChecked: true })
    expect((await f.runner.resume(first.report.runId)).report.counts).toEqual({ done: 2 })
    const keys = site.seen.filter((r) => r.path === '/once').map((r) => r.headers['idempotency-key'])
    expect(keys).toHaveLength(4)
    expect(keys[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(keys[2]).toBe(keys[0])
    expect(keys[3]).toBe(keys[1])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('saves bodies as files named like downloads: sanitized, never overwriting', async () => {
    const site = await serve()
    const file = {
      id: 'file',
      do: 'http' as const,
      url: '{{param.base}}/file',
      saveAs: '{{item.Name}}',
      expect: { status: [200] },
    }
    const rows = 'Email,Name\na@example.test,Ada\nb@example.test,..\\evil\nc@example.test,Ada\n'
    const f = await fixture(site, { item: [file], readOnly: true }, rows)
    const result = await f.start()
    expect(result.report.counts).toEqual({ done: 3 })
    const saved = Object.entries(result.report.files).filter(([name]) => name !== 'file')
    expect(saved.map(([name]) => name).sort()).toEqual(['Ada (2).png', 'Ada.png', 'evil.png'])
    for (const [name, path] of saved) {
      expect(readFileSync(path)).toEqual(Buffer.from([0, 1, 2, 255]))
      expect(join(result.report.dir, name)).toBe(path)
      expect(basename(path)).toBe(name)
    }
    // A literal name keeps its extension and also never overwrites.
    const literal = await fixture(site, { item: [{ ...file, saveAs: 'out' }], readOnly: true })
    const named = await literal.start()
    expect(
      readdirSync(named.report.dir)
        .filter((name) => name.startsWith('out'))
        .sort(),
    ).toEqual(['out (2).png', 'out.png'])
  })

  it('sends form bodies and queries, and follows redirects without leaking headers', async () => {
    const site = await serve()
    const other = await serve()
    const sent = {
      id: 'echo',
      do: 'http' as const,
      method: 'POST' as const,
      url: '{{param.base}}/echo?kept=1',
      query: { email: '{{item.Email}}' },
      body: { form: { name: '{{item.Name}}' } },
      commit: true,
      expect: { status: [201], json: { '/body': 'name=Ada' } },
    }
    const rows = 'Email,Name\na@example.test,Ada\n'
    const f = await fixture(site, { item: [sent] }, rows)
    expect((await f.start()).report.counts).toEqual({ done: 1 })
    expect(site.seen[0]).toMatchObject({ method: 'POST', path: '/echo', body: 'name=Ada' })
    expect(site.seen[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded')

    const get = (id: string, path: string, json: Record<string, string>) => ({
      id,
      do: 'http' as const,
      url: `{{param.base}}${path}`,
      headers: { Authorization: 'Bearer {{param.key}}' },
      expect: { json },
    })
    // Same origin: the headers follow.
    const same = await fixture(
      site,
      { item: [get('same', '/moved', { '/token': 't-123' })], readOnly: true },
      ONE,
    )
    expect((await same.start()).report.counts).toEqual({ done: 1 })
    expect(site.seen.filter((r) => r.path === '/token').map((r) => r.headers.authorization)).toEqual([
      `Bearer ${SECRET}`,
    ])
    // Another origin: a GET goes on without them.
    const host = { '/headers/host': new URL(other.url).host }
    const away = await fixture(
      site,
      { item: [get('away', `/away?to=${other.url}`, host)], readOnly: true },
      ONE,
    )
    expect((await away.start()).report.counts).toEqual({ done: 1 })
    expect(other.seen.map((r) => r.headers.authorization)).toEqual([undefined])
    // A write is never sent to another origin.
    const post = {
      ...sent,
      id: 'away',
      url: `{{param.base}}/away?to=${other.url}`,
      query: undefined,
      expect: { status: [200] },
    }
    const blocked = await fixture(site, { item: [post] }, rows)
    expect((await blocked.start()).report.items[0]?.message).toContain(
      'Refused to send a POST to another origin',
    )
    expect(other.seen).toHaveLength(1)
  })

  it('sends through the browser session when asked, and only then opens the browser', async () => {
    const calls: { url: string; options: Record<string, unknown> }[] = []
    const page = {
      request: {
        fetch: async (url: string, options: Record<string, unknown>) => {
          calls.push({ url, options })
          return {
            status: () => 200,
            headers: () => ({ 'content-type': 'application/json' }),
            body: async () => Buffer.from('{"ok":true}'),
            dispose: async () => {},
          }
        },
      },
      on() {},
      off() {},
      isClosed: () => false,
      screenshot: async () => {},
    }
    const f = harness(ONE, page)
    await f.save({
      name: 'mine',
      description: 'test',
      readOnly: true,
      params: { input: {} },
      items: { from: '{{param.input}}', key: '{{item.Email}}' },
      item: [
        {
          id: 'me',
          do: 'http',
          url: 'https://app.test/me',
          session: 'browser',
          expect: { json: { '/ok': 'true' } },
        },
      ],
    })
    expect((await f.runner.start('mine', { input: f.input })).report.counts).toEqual({ done: 1 })
    expect(f.browser.launched).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://app.test/me',
      options: { method: 'GET', maxRedirects: 0, failOnStatusCode: false },
    })
  })
})

describe('JSON pointer', () => {
  it('reads nested values, array items and escaped keys, and finds nothing otherwise', () => {
    const value = { a: { b: [10, { c: 'x' }] }, 'k/l': 1, 'm~n': 2, '': 3 }
    expect(pointer(value, '')).toBe(value)
    expect(pointer(value, '/a/b/0')).toBe(10)
    expect(pointer(value, '/a/b/1/c')).toBe('x')
    expect(pointer(value, '/k~1l')).toBe(1)
    expect(pointer(value, '/m~0n')).toBe(2)
    expect(pointer(value, '/')).toBe(3)
    expect(pointer(value, '/a/b/length')).toBeUndefined()
    expect(pointer(value, '/a/b/2')).toBeUndefined()
    expect(pointer(value, '/a/x/y')).toBeUndefined()
    expect(pointer(value, '/toString')).toBeUndefined()
  })
})
