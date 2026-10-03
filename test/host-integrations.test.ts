import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Host, type HostResponse } from '../src/engine/host.ts'
import type { HostIo } from '../src/engine/host-io.ts'
import { agentArgs } from '../src/engine/integrations.ts'
import type { WorkflowInput } from '../src/engine/schema.ts'
import { hasSecrets } from '../src/engine/template.ts'
import { api } from './support/api.ts'
import { harness } from './support/harness.ts'

const shutdown: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of shutdown.splice(0)) await close()
})

async function fixture(item: WorkflowInput['item'], extra: Partial<WorkflowInput> = {}) {
  const f = harness()
  const pages: { target: string; fragment: string }[] = []
  const io: HostIo = {
    carry: async (batch) => batch.map((page) => `http://127.0.0.1:1/${pages.push(page)}`),
    clipboard: { read: () => '', write: () => {} },
  }
  const workflow = {
    name: 'mixed',
    description: 'Mixed integration regression',
    params: { input: {} },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: 'fixture' },
    item,
    ...extra,
  }
  await f.save(workflow)
  const host = new Host(f.ledger, f.store, join(f.root, 'runs'), io)
  return { ...f, host, io, pages, start: () => host.start('mixed', { input: f.input }) }
}

const tool = (response: HostResponse) => {
  const action = response.actions.find((action) => action.type === 'tool')
  if (action?.type !== 'tool') throw new Error('Expected a tool action')
  return action
}

describe('mixed host integrations', () => {
  test('detects credentials containing JSON escapes before agent handoff', () => {
    const password = 'secret"with\\escapes\nand-newline'
    const scope = { param: {}, item: {}, files: {}, vars: { value: password }, secrets: [password] }
    expect(hasSecrets({ nested: [password] }, scope)).toBe(true)
    expect(() =>
      agentArgs({ id: 'call', do: 'mcp', server: 's', tool: 't', args: { value: '{{vars.value}}' } }, scope),
    ).toThrow(/secret/)
  })
  test('keeps saved objects with newly discovered credentials out of the journal', async () => {
    const f = await fixture(
      [
        {
          id: 'read',
          do: 'mcp',
          server: 'studio',
          tool: 'read',
          readOnly: true,
          save: { bundle: '/payload' },
          expect: { json: { '/ok': 'true' } },
        },
      ],
      { readOnly: true, servers: { studio: { ref: 'agent' } } },
    )
    const first = await f.start()
    const secret = 'unknown"secret\\with\nnewline'
    await f.host.next(first.runId, {
      batch: first.batch,
      results: [
        {
          actionId: tool(first).actionId,
          result: { content: [], structuredContent: { ok: true, payload: { access_token: secret } } },
        },
      ],
    })
    expect(f.ledger.items(first.runId)[0]?.vars).toEqual({})
    expect(f.dump()).not.toContain('unknown')
  })
  test('executes API-only batches without browser actions and skips completed rows', async () => {
    const site = await api()
    shutdown.push(() => site.close())
    const f = await fixture([
      {
        id: 'create',
        do: 'http',
        method: 'POST',
        url: `${site.url}/orders`,
        commit: true,
        body: { json: { email: '{{item.Email}}' } },
        save: { order: '/id' },
        idempotencyKey: true,
      },
      {
        id: 'verify',
        do: 'http',
        url: `${site.url}/orders/{{vars.order}}`,
        expect: { json: { '/id': '{{vars.order}}', '/status': 'paid' } },
      },
    ])
    const first = await f.start()
    expect(first.done).toMatchObject({ status: 'done', counts: { done: 2 } })
    expect(first.actions).toEqual([])
    expect(f.pages).toEqual([])
    expect(site.count('POST', '/orders')).toBe(2)
    expect(f.ledger.items(first.runId).map((row) => row.vars.order)).toEqual(['o-1', 'o-2'])
    expect((await f.start()).done?.counts).toEqual({ skipped: 2 })
    expect(site.count('POST', '/orders')).toBe(2)
  })

  test('keeps row variables through a browser segment and a fresh host instance', async () => {
    const site = await api()
    shutdown.push(() => site.close())
    const f = await fixture([
      { id: 'lookup', do: 'http', url: `${site.url}/orders/{{item.Name}}`, save: { name: '/id' } },
      { id: 'open', do: 'goto', url: 'https://example.test/form' },
      { id: 'fill', do: 'fill', target: { primary: { by: 'label', text: 'Name' } }, value: '{{vars.name}}' },
      {
        id: 'submit',
        do: 'click',
        target: { primary: { by: 'role', role: 'button', name: 'Submit' } },
        commit: true,
      },
      { id: 'page-proof', do: 'expect', text: 'Created {{item.Email}}' },
      {
        id: 'api-proof',
        do: 'http',
        url: `${site.url}/orders/{{vars.name}}`,
        expect: { json: { '/id': '{{vars.name}}' } },
      },
    ])
    const first = await f.start()
    const plan = JSON.parse(decodeURIComponent(f.pages[0]?.fragment ?? '')).plan
    expect(plan.steps.map((step: { do: string }) => step.do)).toEqual(['fill', 'click', 'expect'])
    expect(plan.steps[0].value).toBe('Ada')
    const reopened = new Host(f.ledger, f.store, join(f.root, 'runs'), f.io)
    const second = await reopened.next(first.runId, {
      batch: first.batch,
      results: [{ ok: true, next: 5, sent: 3 }],
    })
    expect(f.ledger.items(first.runId)[0]?.status).toBe('done')
    expect(JSON.parse(decodeURIComponent(f.pages[1]?.fragment ?? '')).plan.steps[0].value).toBe('Bob')
    const done = await reopened.next(first.runId, {
      batch: second.batch,
      results: [{ ok: true, next: 5, sent: 3 }],
    })
    expect(done.done?.counts).toEqual({ done: 2 })
    expect(site.count('GET', '/orders/Ada')).toBe(2)
    expect(site.count('GET', '/orders/Bob')).toBe(2)
  })

  test('hands off existing tools with frozen arguments and identity, holds a missing write result', async () => {
    const f = await fixture(
      [
        {
          id: 'create',
          do: 'mcp',
          server: 'studio',
          tool: 'create',
          commit: true,
          args: { email: '{{item.Email}}' },
          expect: { json: { '/email': '{{item.Email}}' } },
          save: { receipt: '/id' },
        },
      ],
      { servers: { studio: { ref: 'agent' } } },
    )
    const first = await f.start()
    const before = f.ledger.items(first.runId)
    expect(f.runner.report(first.runId).driver).toBe('host')
    await expect(f.runner.resume(first.runId)).rejects.toThrow(/host_next/)
    expect(f.ledger.items(first.runId)).toEqual(before)
    const action = tool(first)
    expect(action.args).toEqual({ email: 'a@example.test' })
    expect(f.ledger.items(first.runId)[0]?.committed).toBe(true)
    const raw = {
      content: [{ type: 'text', text: JSON.stringify({ email: 'a@example.test', id: 'receipt-a' }) }],
    }
    await expect(
      f.host.next(first.runId, { batch: first.batch, results: [{ actionId: 'wrong', result: raw }] }),
    ).rejects.toThrow(/tool result/)
    const second = await f.host.next(first.runId, {
      batch: first.batch,
      results: [{ actionId: action.actionId, result: raw }],
    })
    expect(tool(second).args).toEqual({ email: 'b@example.test' })
    const done = await f.host.next(first.runId)
    expect(done.done).toMatchObject({ status: 'partial', counts: { done: 1, review: 1 } })
    expect(f.ledger.items(first.runId)[0]?.vars.receipt).toBe('receipt-a')
    expect((await f.start()).done?.counts).toEqual({ skipped: 1, review: 1 })
  })

  test.each([
    {
      content: [{ type: 'text', text: '{"access_token":"unknown-error-secret","error":"denied"}' }],
      isError: true,
    },
    { resultType: 'input_required', inputRequests: {} },
  ])('holds error or incomplete tool results after commit', async (result) => {
    const f = await fixture(
      [
        {
          id: 'create',
          do: 'mcp',
          server: 'studio',
          tool: 'create',
          commit: true,
          expect: { json: { '/email': '{{item.Email}}' } },
        },
      ],
      { servers: { studio: { ref: 'agent' } } },
    )
    const first = await f.start()
    const second = await f.host.next(first.runId, {
      batch: first.batch,
      results: [{ actionId: tool(first).actionId, result }],
    })
    expect(f.ledger.items(first.runId)[0]?.status).toBe('review')
    expect(f.dump()).not.toContain('unknown-error-secret')
    expect(tool(second).actionId).not.toBe(tool(first).actionId)
  })

  test('resumes a resolved absent write and rechecks duplicate holds without repeating completed rows', async () => {
    const f = await fixture(
      [
        {
          id: 'create',
          do: 'mcp',
          server: 'studio',
          tool: 'create',
          commit: true,
          expect: { json: { '/email': '{{item.Email}}' } },
        },
      ],
      { servers: { studio: { ref: 'agent' } } },
    )
    const first = await f.start()
    const second = await f.host.next(first.runId, {
      batch: first.batch,
      results: [
        {
          actionId: tool(first).actionId,
          result: { content: [], structuredContent: { email: 'a@example.test' } },
        },
      ],
    })
    expect((await f.host.next(first.runId)).done?.counts).toEqual({ done: 1, review: 1 })
    const blocked = await f.start()
    expect(blocked.done?.counts).toEqual({ skipped: 1, review: 1 })
    await f.runner.resolve(first.runId, 'b@example.test', 'failed', 'Checked tool ledger: no job exists')
    const resumed = await f.host.next(first.runId)
    expect(tool(resumed).args).toEqual({})
    expect(tool(resumed).actionId).not.toBe(tool(second).actionId)
    const done = await f.host.next(first.runId, {
      batch: resumed.batch,
      results: [
        {
          actionId: tool(resumed).actionId,
          result: { content: [], structuredContent: { email: 'b@example.test' } },
        },
      ],
    })
    expect(done.done?.counts).toEqual({ done: 2 })
    expect((await f.host.next(blocked.runId)).done?.counts).toEqual({ skipped: 2 })
  })
})
