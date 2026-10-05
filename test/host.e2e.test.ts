import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Page } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import { Browser } from '../src/engine/browser.ts'
import { Host, type HostResponse } from '../src/engine/host.ts'
import { type HostIo, systemIo } from '../src/engine/host-io.ts'
import {
  bootCode,
  type HostProgram,
  type HostStep,
  inlineCode,
  runtimeSource,
} from '../src/engine/host-page.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { NetworkCapture } from '../src/engine/network.ts'
import { Store } from '../src/engine/store.ts'
import { api } from './support/api.ts'
import { lab } from './support/lab.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish()
})

/** A site, a temporary home and a headless Chrome, torn down after the test. */
async function setup() {
  const site = await lab()
  const root = mkdtempSync(join(tmpdir(), 'ritoko-e2e-'))
  const ledger = new Ledger(join(root, 'ritoko.db'))
  const store = new Store(join(root, 'workflows'))
  const browser = new Browser({ profile: join(root, 'profile'), headless: true })
  cleanup.push(async () => {
    await browser.shutdown().catch(() => {})
    await site.close()
    try {
      ledger.db.close()
    } catch {
      /* A recovery test already closed the original connection. */
    }
    for (let i = 0; i < 30; i++) {
      try {
        rmSync(root, { recursive: true, force: true })
        return
      } catch {
        await delay(100)
      }
    }
    throw new Error(`Chrome did not release the test profile: ${root}`)
  })
  const page = await browser.page()
  // The OS clipboard is never touched: the page's copy is captured where it is made.
  await page.context().addInitScript(() => {
    const original = document.execCommand.bind(document)
    document.execCommand = (command: string, ...rest: [boolean?, string?]) => {
      if (command !== 'copy') return original(command, ...rest)
      ;(window as unknown as { __copied?: string }).__copied = document.querySelector('textarea')?.value
      return true
    }
  })
  await page.goto('about:blank')
  return { site, root, ledger, store, browser, page }
}

const label = (text: string) => ({ primary: { by: 'label', text }, fallbacks: [] })
const named = (role: string, name: string) => ({ primary: { by: 'role', role, name }, fallbacks: [] })
const step = (index: number, id: string, kind: string, rest: Partial<HostStep> = {}): HostStep => ({
  index,
  id,
  do: kind,
  timeoutMs: 3000,
  ...rest,
})
const program = (steps: HostStep[], rest: Partial<HostProgram> = {}): HostProgram => ({
  steps,
  token: 'tok',
  budgetMs: 20_000,
  ...rest,
})
/** What the agent's JavaScript tool does with the code Ritoko hands out. */
const run = (page: Page, code: string) => page.evaluate(code)
const shield = async (page: Page) => ({
  count: await page.locator('#ritoko-shield').count(),
  text: await page.locator('#ritoko-shield').textContent(),
})
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied?: string }).__copied)

describe('host mode page runtime', () => {
  const customer: HostStep[] = [
    step(0, 'email', 'fill', { target: label('Email') as HostStep['target'], value: 'a@example.test' }),
    step(1, 'name', 'fill', { target: label('Name') as HostStep['target'], value: 'Ada' }),
    step(2, 'submit', 'click', {
      target: named('button', 'Create customer') as HostStep['target'],
      commit: true,
    }),
    step(3, 'verify', 'expect', { text: 'Created a@example.test' }),
  ]

  it('fills, clicks and expects in a real page, reports the last step sent, and leaves a shield', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/spa`)
    const network = new NetworkCapture()
    network.begin(f.page, 'create')
    expect(await run(f.page, inlineCode(program(customer)))).toEqual({ ok: true, next: 4, sent: 2 })
    network.end()
    expect(f.site.submissions).toEqual([{ Email: 'a@example.test', Name: 'Ada' }])
    expect(network.hints('create')).toContainEqual({
      method: 'POST',
      origin: f.site.url,
      path: '/submit',
      queryKeys: [],
      bodyKeys: ['Email', 'Name'],
      status: 200,
    })
    expect(JSON.stringify(network.hints('create'))).not.toContain('a@example.test')
    network.clear()
    expect(await shield(f.page)).toEqual({ count: 1, text: 'Ritoko' })

    // A missing button: the fills were dispatched, the commit was not.
    await f.page.goto(`${f.site.url}/spa`)
    const broken = [...customer]
    broken[2] = {
      ...customer[2],
      target: named('button', 'Nothing') as HostStep['target'],
      timeoutMs: 300,
    } as HostStep
    expect(await run(f.page, inlineCode(program(broken)))).toMatchObject({
      ok: false,
      at: 2,
      selector: true,
      sent: 1,
    })
    expect(f.site.submissions).toHaveLength(1)
    // The shield replaces the previous one: always exactly one.
    expect(await shield(f.page)).toEqual({ count: 1, text: 'Ritoko' })
  })

  it('resumes from a step, and returns pending when a wait outlives the budget or the post-commit settle', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/spa`)
    await run(f.page, inlineCode(program(customer)))
    expect(await run(f.page, inlineCode(program(customer, { from: 3 })))).toEqual({
      ok: true,
      next: 4,
      sent: -1,
    })
    const wait = step(4, 'later', 'expect', { text: 'never', timeoutMs: 20_000 })
    expect(await run(f.page, inlineCode(program([wait], { budgetMs: 400 })))).toMatchObject({
      ok: true,
      pending: 4,
      sent: -1,
    })
    // After the commit, the call may last settleMs at most: the wait returns pending at once.
    await f.page.goto(`${f.site.url}/spa`)
    const slow = program([...customer.slice(0, 3), wait], { settleMs: 300 })
    const started = Date.now()
    expect(await run(f.page, inlineCode(slow))).toMatchObject({ ok: true, pending: 4, sent: 2 })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('captures a fetched download, stages it behind the shield and hands it over on a click anywhere', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/gen`)
    const steps = [
      step(0, 'ready', 'expect', { text: 'Ready' }),
      step(1, 'save', 'download', {
        target: named('button', 'Save image') as HostStep['target'],
        timeoutMs: 8000,
      }),
    ]
    const result = await run(f.page, inlineCode(program(steps)))
    expect(result).toEqual({ ok: true, next: 2, sent: 1, staged: { bytes: 30_000, type: 'image/png' } })
    expect(await shield(f.page)).toEqual({ count: 1, text: 'Ritoko · transmettre' })
    // Any point of the viewport is the shield, never the site's own button.
    await f.page.mouse.click(200, 200)
    const payload = (await copied(f.page)) ?? ''
    expect(payload.startsWith('RITOKO|tok.1|data:image/png;base64,')).toBe(true)
    expect(Buffer.from(payload.split(',')[1] ?? '', 'base64')).toEqual(Buffer.alloc(30_000, 7))
    expect((await shield(f.page)).text).toBe('Ritoko · transmis')
    // The data stays behind the shield: a second click copies it again.
    await f.page.evaluate(() => {
      ;(window as unknown as { __copied?: string }).__copied = undefined
    })
    await f.page.mouse.click(200, 200)
    expect(await copied(f.page)).toBe(payload)
    // The next runtime call removes it.
    expect(await run(f.page, inlineCode(program([])))).toEqual({ ok: true, next: 0, sent: -1 })
    expect(await shield(f.page)).toEqual({ count: 1, text: 'Ritoko' })
    await f.page.mouse.click(200, 200)
    expect(await copied(f.page)).toBe(payload)
  })

  it('does not click a download with little budget left: it waits for the next call', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/gen`)
    const save = step(1, 'save', 'download', {
      target: named('button', 'Save image') as HostStep['target'],
      timeoutMs: 8000,
    })
    await run(f.page, inlineCode(program([step(0, 'ready', 'expect', { text: 'Ready' })])))
    expect(await run(f.page, inlineCode(program([save], { budgetMs: 5000 })))).toMatchObject({
      ok: true,
      pending: 1,
      sent: -1,
    })
    expect((await shield(f.page)).text).toBe('Ritoko')
  })

  const deliver = (steps: HostStep[], files: Record<number, string> = {}) =>
    encodeURIComponent(JSON.stringify({ runtime: runtimeSource, plan: program(steps), files }))

  it('boots from the URL fragment, then from sessionStorage after a reload, and covers a page it cannot serve', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/spa#ritoko=${deliver(customer)}`)
    const boot = (from: number) => run(f.page, bootCode(from))
    expect(await boot(0)).toEqual({ ok: true, next: 4, sent: 2 })
    // The fragment is gone from the address, the plan is kept for the tab.
    expect(f.page.url()).toBe(`${f.site.url}/spa`)
    expect(await f.page.evaluate(() => sessionStorage.getItem('ritoko:run'))).toContain('hostProgram')
    await f.page.reload()
    expect(await f.page.evaluate(() => '__ritokoHost' in window)).toBe(false)
    expect(await boot(0)).toEqual({ ok: true, next: 4, sent: 2 })
    // Another tab has neither: a bare shield, and the answer that makes Ritoko send the long form.
    const other = await f.page.context().newPage()
    await other.goto(`${f.site.url}/spa`)
    expect(await run(other, bootCode(0))).toEqual({ ok: false, missing: true })
    expect(await shield(other)).toMatchObject({ count: 1 })
    await other.close()
  })

  it('carries a file in the fragment, in memory and in sessionStorage', async () => {
    const f = await setup()
    const pick = [step(0, 'pick', 'upload', { target: label('File') as HostStep['target'] })]
    const files = { 0: `data:text/plain;base64,${Buffer.from('hello file').toString('base64')}` }
    await f.page.goto(`${f.site.url}/pick#ritoko=${deliver(pick, files)}`)
    expect(await run(f.page, bootCode(0))).toEqual({ ok: true, next: 1, sent: 0 })
    expect(await f.page.locator('#out').textContent()).toBe('upload:text/plain:hello file')
    expect(await f.page.evaluate(() => sessionStorage.getItem('ritoko:files'))).toContain(
      Buffer.from('hello file').toString('base64'),
    )
    // Without the file, the step says so instead of uploading nothing.
    await f.page.goto(`${f.site.url}/pick#ritoko=${deliver(pick)}`)
    expect(await run(f.page, bootCode(0))).toMatchObject({ ok: false, at: 0, sent: -1 })
  })

  it('refuses a stale plan token and keeps target text verification scoped to its element', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/spa#ritoko=${deliver(customer)}`)
    expect(await run(f.page, bootCode(0, 'different-item'))).toEqual({ ok: false, missing: true })
    expect(f.site.submissions).toHaveLength(0)
    // The plan remains available for the right token, without another navigation.
    expect(await run(f.page, bootCode(0, 'tok'))).toEqual({ ok: true, next: 4, sent: 2 })
    const wrongTarget = step(4, 'check-name', 'expect', {
      target: label('Name') as HostStep['target'],
      text: 'Created a@example.test',
      timeoutMs: 200,
    })
    expect(await run(f.page, inlineCode(program([wrongTarget])))).toMatchObject({ ok: false, at: 4 })
  })

  it('reports a timed wait as pending until its full duration has elapsed across calls', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/spa`)
    const wait = step(0, 'wait', 'wait', { ms: 500 })
    const first = (await run(f.page, inlineCode(program([wait], { from: 0, budgetMs: 200 })))) as {
      waited: number
    }
    expect(first).toMatchObject({ ok: true, pending: 0, sent: -1 })
    expect(
      await run(f.page, inlineCode(program([wait], { from: 0, budgetMs: 600, waitedMs: first.waited }))),
    ).toEqual({ ok: true, next: 1, sent: -1 })
  })

  it('captures a small direct CSV download without opening the native browser save', async () => {
    const f = await setup()
    await f.page.goto(`${f.site.url}/spa`)
    await f.page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<a download href="/download">Download CSV</a>')
    })
    const events: unknown[] = []
    f.page.on('download', (event) => events.push(event))
    const save = step(0, 'csv', 'download', { target: named('link', 'Download CSV') as HostStep['target'] })
    expect(await run(f.page, inlineCode(program([save])))).toMatchObject({
      ok: true,
      next: 1,
      staged: { type: 'text/csv' },
    })
    expect(events).toHaveLength(0)
    await f.page.mouse.click(200, 200)
    const payload = await copied(f.page)
    expect(Buffer.from(payload?.split(',')[1] ?? '', 'base64').toString()).toBe(
      'Email,Name\na@example.test,Ada\n',
    )
  })
})

describe('host mode protocol', () => {
  type Next = (input: { batch: number; results: unknown[] }) => Promise<HostResponse>

  /** The agent, played in Chrome: runs each batch's actions in order and reports like a real one. */
  async function agent(
    next: Next,
    first: HostResponse,
    page: Page,
    clipboard: { text: string },
    site: string,
    slots = new Map<number, Page>([[1, page]]),
    expectedLanes = 1,
  ) {
    const tabs = new Set<number>()
    let response = first
    for (let batches = 1; !response.done; batches++) {
      expect(batches).toBeLessThan(40)
      const results: unknown[] = []
      for (const action of response.actions) {
        let active = slots.get(action.tab)
        if (!active) {
          active = await page.context().newPage()
          slots.set(action.tab, active)
        }
        if (action.type === 'navigate') {
          tabs.add(action.tab)
          await active.goto(action.url)
          // A carry page replaces itself with the site.
          if (new URL(action.url).port !== new URL(site).port) await active.waitForURL(`${site}/**`)
        }
        if (action.type === 'run_js') results.push(await run(active, action.code))
        if (action.type === 'click') {
          await active.mouse.click(action.x, action.y)
          clipboard.text = (await copied(active)) ?? clipboard.text
        }
      }
      response = await next({ batch: response.batch, results })
    }
    expect([...tabs]).toEqual(Array.from({ length: expectedLanes }, (_, i) => i + 1))
    return response
  }

  const customers = (site: string) => ({
    name: 'spa',
    description: 'Host mode against the lab',
    params: { input: { description: 'csv' } },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: 'lab' },
    item: [
      { id: 'open', do: 'goto', url: `${site}/spa` },
      { id: 'email', do: 'fill', target: label('Email'), value: '{{item.Email}}' },
      { id: 'name', do: 'fill', target: label('Name'), value: '{{item.Name}}' },
      { id: 'submit', do: 'click', target: named('button', 'Create customer'), commit: true },
      { id: 'verify', do: 'expect', text: 'Created {{item.Email}}' },
    ],
  })
  const emails = ['a@example.test', 'b@example.test', 'c@example.test']

  async function protocol() {
    const f = await setup()
    const clipboard = { text: 'the user text' }
    const io: HostIo = {
      carry: systemIo.carry,
      clipboard: {
        read: () => clipboard.text,
        write: (text) => {
          clipboard.text = text
        },
      },
    }
    const host = new Host(f.ledger, f.store, join(f.root, 'runs'), io)
    const input = join(f.root, 'input.csv')
    writeFileSync(
      input,
      'Email,Name,Slug\na@example.test,Ada,ada\nb@example.test,Bob,bob\nc@example.test,Cy,cy\n',
    )
    return { ...f, host, clipboard, input }
  }

  it('submits a batch through the carry page, each item once, and skips every row on a rerun', async () => {
    const f = await protocol()
    await f.store.save(customers(f.site.url))
    const first = await f.host.start('spa', { input: f.input })
    const next: Next = (input) => f.host.next(first.runId, input)
    const done = await agent(next, first, f.page, f.clipboard, f.site.url)
    expect(done.done).toMatchObject({ status: 'done', counts: { done: 3 } })
    expect(f.site.submissions.map((s) => s.Email)).toEqual(emails)
    const again = await f.host.start('spa', { input: f.input })
    expect(again.done).toMatchObject({ status: 'done', counts: { skipped: 3 } })
    expect(f.site.submissions).toHaveLength(3)
  })

  it('replays API lookup, real browser submission and API verification in the same journal', async () => {
    const f = await protocol()
    const service = await api()
    cleanup.push(() => service.close())
    const original = customers(f.site.url)
    const item = original.item.map((step) =>
      step.id === 'name' ? { ...step, value: '{{vars.display}}' } : step,
    )
    await f.store.save({
      ...original,
      item: [
        { id: 'lookup', do: 'http', url: `${service.url}/orders/{{item.Name}}`, save: { display: '/id' } },
        ...item,
        {
          id: 'api-verify',
          do: 'http',
          url: `${service.url}/orders/{{vars.display}}`,
          expect: { json: { '/id': '{{item.Name}}' } },
        },
      ],
    })
    const first = await f.host.start('spa', { input: f.input })
    const done = await agent(
      (input) => f.host.next(first.runId, input),
      first,
      f.page,
      f.clipboard,
      f.site.url,
    )
    expect(done.done?.counts).toEqual({ done: 3 })
    expect(f.site.submissions.map((row) => row.Name)).toEqual(['Ada', 'Bob', 'Cy'])
    expect(service.count('GET', '/orders/Ada')).toBe(2)
    expect(f.ledger.items(first.runId).map((row) => row.vars.display)).toEqual(['Ada', 'Bob', 'Cy'])
    await f.host.close()
  })

  it('finishes twenty rows across four tabs after reopening an interrupted journal and resolving the committed rows', async () => {
    const f = await protocol()
    const emails = Array.from({ length: 20 }, (_, i) => `stress${i}@example.test`)
    writeFileSync(f.input, `Email,Name\n${emails.map((email, i) => `${email},User ${i}`).join('\n')}\n`)
    await f.store.save(customers(f.site.url))
    const first = await f.host.start('spa', { input: f.input }, { parallel: 4 })
    const slots = new Map<number, Page>([[1, f.page]])
    // Four real submissions reach the site, then the agent loses the entire result report.
    for (const action of first.actions) {
      let active = slots.get(action.tab)
      if (!active) {
        active = await f.page.context().newPage()
        slots.set(action.tab, active)
      }
      if (action.type === 'navigate') {
        await active.goto(action.url)
        await active.waitForURL(`${f.site.url}/**`)
      }
      if (action.type === 'run_js')
        expect(await run(active, action.code)).toMatchObject({ ok: true, next: 5 })
    }
    expect(f.site.submissions).toHaveLength(4)
    f.ledger.db.close()
    const reopened = new Ledger(join(f.root, 'ritoko.db'))
    cleanup.push(async () => reopened.db.close())
    const recovered = new Host(reopened, f.store, join(f.root, 'runs'), {
      carry: systemIo.carry,
      clipboard: {
        read: () => f.clipboard.text,
        write: (text) => {
          f.clipboard.text = text
        },
      },
    })
    const resume = await recovered.next(first.runId)
    expect(reopened.items(first.runId).filter((item) => item.status === 'review')).toHaveLength(4)
    // Establish each outcome from the local site's recorded business rows before manual resolution.
    for (const item of reopened.items(first.runId).filter((row) => row.status === 'review')) {
      expect(f.site.submissions.some((row) => row.Email === item.key)).toBe(true)
      reopened.resolve(
        first.runId,
        item.key,
        'done',
        'Confirmed the exact email in the local lab submissions',
        {
          by: 'manual',
          confirmChecked: true,
        },
      )
    }
    const done = await agent(
      (input) => recovered.next(first.runId, input),
      resume,
      f.page,
      f.clipboard,
      f.site.url,
      slots,
      4,
    )
    expect(done.done).toMatchObject({ status: 'done', counts: { done: 20 } })
    expect(f.site.submissions.map((row) => row.Email).sort()).toEqual([...emails].sort())
    expect(new Set(f.site.submissions.map((row) => row.Email)).size).toBe(20)
    const rerun = await recovered.start('spa', { input: f.input }, { parallel: 4 })
    expect(rerun.done?.counts).toEqual({ skipped: 20 })
    expect(f.site.submissions).toHaveLength(20)
  })

  it('saves each generated file under its row name, handed over by a click, and restores the clipboard', async () => {
    const f = await protocol()
    await f.store.save({
      name: 'gen',
      description: 'Generation and download',
      readOnly: true,
      params: { input: { description: 'csv' } },
      items: { from: '{{param.input}}', key: '{{item.Email}}' },
      item: [
        { id: 'open', do: 'goto', url: `${f.site.url}/gen` },
        { id: 'ready', do: 'expect', text: 'Ready', timeoutMs: 600_000 },
        {
          id: 'save',
          do: 'download',
          target: named('button', 'Save image'),
          saveAs: '{{item.Slug}}',
          timeoutMs: 600_000,
        },
      ],
    })
    const first = await f.host.start('gen', { input: f.input })
    const done = await agent(
      (input) => f.host.next(first.runId, input),
      first,
      f.page,
      f.clipboard,
      f.site.url,
    )
    expect(done.done).toMatchObject({ status: 'done', counts: { done: 3 } })
    expect(Object.keys(done.done?.files ?? {}).sort()).toEqual(['ada.png', 'bob.png', 'cy.png', 'save'])
    for (const path of Object.values(done.done?.files ?? {}))
      expect(readFileSync(path)).toEqual(Buffer.alloc(30_000, 7))
    expect(f.clipboard.text).toBe('the user text')
  })

  it('serves the same protocol through the MCP tools', async () => {
    const f = await setup()
    await f.store.save(customers(f.site.url))
    const input = join(f.root, 'input.csv')
    writeFileSync(input, 'Email,Name\na@example.test,Ada\nb@example.test,Bob\nc@example.test,Cy\n')
    const { client, call } = await mcp(f.root)
    const tools = (await client.listTools()).tools
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['host_start', 'host_next']))
    const reply = async (name: string, args: Record<string, unknown>) =>
      JSON.parse((await call(name, args))[0]?.text ?? '{}') as HostResponse
    const first = await reply('host_start', { workflow: 'spa', params: { input } })
    const report = JSON.parse((await call('run_report', { runId: first.runId }))[0]?.text ?? '{}')
    expect(report).toMatchObject({ driver: 'host', status: 'running', counts: { running: 1, pending: 2 } })
    await expect(call('run_resume', { runId: first.runId })).rejects.toThrow(/host_next/)
    const next: Next = (more) => reply('host_next', { runId: first.runId, ...more })
    const done = await agent(next, first, f.page, { text: '' }, f.site.url)
    expect(done.done).toMatchObject({ status: 'done', counts: { done: 3 } })
    expect(f.site.submissions.map((s) => s.Email)).toEqual(emails)
    await expect(call('host_next', { runId: 'nope' })).rejects.toThrow(/Unknown run/)
  })
})

/** The MCP server, started through the plugin launcher as Claude Code and Codex start it. */
async function mcp(root: string) {
  const client = new Client({ name: 'ritoko-e2e', version: '1.0.0' })
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(resolve('.'), 'bin', 'ritoko.mjs'), 'mcp'],
    cwd: resolve('.'),
    env: { ...env, RITOKO_HOME: root, RITOKO_HEADLESS: '1' },
    stderr: 'pipe',
  })
  cleanup.push(async () => {
    await client.close()
  })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    if (result.isError) throw new Error(JSON.stringify(result.content))
    return result.content as { type: string; text: string }[]
  }
  return { client, call }
}
