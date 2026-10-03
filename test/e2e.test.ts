import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it } from 'vitest'
import { Browser } from '../src/engine/browser.ts'
import { download } from '../src/engine/download.ts'
import { Ledger } from '../src/engine/ledger.ts'
import { Runner } from '../src/engine/runner.ts'
import { Store } from '../src/engine/store.ts'
import { lab } from './support/lab.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const finish of cleanup.splice(0).reverse()) await finish()
})
const label = (text: string) => ({ primary: { by: 'label' as const, text }, fallbacks: [] })

async function fixture(count = 3, broken = false) {
  const root = mkdtempSync(join(tmpdir(), 'ritoko-e2e-'))
  const site = await lab()
  const ledger = new Ledger(join(root, 'ritoko.db'))
  const store = new Store(join(root, 'workflows'))
  const browser = new Browser({ profile: join(root, 'profile'), headless: true })
  cleanup.push(async () => {
    await browser.shutdown().catch(() => {})
    await site.close()
    ledger.db.close()
    // Chrome exits asynchronously and may briefly retain profile files on Windows.
    if (!root.startsWith(join(tmpdir(), 'ritoko-e2e-'))) throw new Error('Unsafe cleanup path')
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
  const input = join(root, 'input.csv')
  writeFileSync(
    input,
    `Email,Name\n${Array.from({ length: count }, (_, i) => `user${i + 1}@example.test,User ${i + 1}`).join('\n')}\n`,
  )
  const { workflow: wf } = await store.save({
    name: 'customers',
    description: 'Local regression lab',
    params: { input: { description: 'csv' }, base: { description: 'site', default: site.url } },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: '{{param.base}}' },
    setup: [{ id: 'setup', do: 'goto', url: '{{param.base}}/' }],
    item: [
      { id: 'open-form', do: 'goto', url: '{{param.base}}/form' },
      {
        id: 'email',
        do: 'fill',
        target: label(broken ? 'Old email' : 'Email'),
        value: '{{item.Email}}',
        timeoutMs: 100,
      },
      { id: 'name', do: 'fill', target: label('Name'), value: '{{item.Name}}' },
      {
        id: 'submit',
        do: 'click',
        commit: true,
        target: { primary: { by: 'role', role: 'button', name: 'Create customer' }, fallbacks: [] },
      },
      { id: 'verify', do: 'expect', text: 'Created {{item.Email}}', timeoutMs: 200 },
    ],
  })
  const runner = new Runner(browser, ledger, store, join(root, 'runs'))
  return { root, site, ledger, store, browser, runner, input, wf }
}

describe('Chrome and real server effects', () => {
  it('journals file selection that automatically submits and blocks another upload', async () => {
    const f = await fixture(1)
    const file = join(f.root, 'upload.csv')
    const input = join(f.root, 'upload-input.csv')
    writeFileSync(file, 'Invoice,Total\n123,42.00\n')
    writeFileSync(input, `ID,File\none,${file}\n`)
    await f.store.save({
      name: 'auto-upload',
      description: 'File selection submits immediately',
      params: { input: { description: 'csv' } },
      items: { from: '{{param.input}}', key: '{{item.ID}}' },
      item: [
        { id: 'open', do: 'goto', url: `${f.site.url}/upload-form` },
        { id: 'choose', do: 'upload', target: label('CSV'), file: '{{item.File}}', commit: true },
        { id: 'confirmed', do: 'expect', text: 'Uploaded CSV', timeoutMs: 2000 },
      ],
    })
    const first = await f.runner.start('auto-upload', { input })
    expect(first.status).toBe('done')
    expect(f.site.uploads).toHaveLength(1)
    expect(f.site.uploads[0]).toContain('123,42.00')
    expect((await f.runner.start('auto-upload', { input })).report.counts).toEqual({ skipped: 1 })
    expect(f.site.uploads).toHaveLength(1)
    f.site.failConfirmation()
    expect((await f.runner.start('auto-upload', { input }, { repeat: true })).report.counts).toEqual({
      review: 1,
    })
    expect((await f.runner.start('auto-upload', { input }, { repeat: true })).report.counts).toEqual({
      review: 1,
    })
    expect(f.site.uploads).toHaveLength(2)
  })

  it('records, adopts and replays through the plugin launcher and MCP protocol', async () => {
    const f = await fixture(2)
    const client = new Client({ name: 'ritoko-e2e', version: '1.0.0' })
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(resolve('.'), 'bin', 'ritoko.mjs'), 'mcp'],
      cwd: resolve('.'),
      env: { ...env, RITOKO_HOME: f.root, RITOKO_HEADLESS: '1' },
      stderr: 'pipe',
    })
    cleanup.push(async () => {
      await client.close()
    })
    await client.connect(transport)
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('run_resolve')
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      if (result.isError) throw new Error(JSON.stringify(result.content))
      return result.content as { type: string; text: string }[]
    }
    const snapshot = (await call('browser_open', { url: `${f.site.url}/form` }))[0]?.text ?? ''
    const ref = (name: string) => {
      const line = snapshot.split('\n').find((s) => s.includes(`"${name}"`))
      const value = line?.match(/\[ref=([^\]]+)\]/)?.[1]
      if (!value) throw new Error(`Missing ${name} ref in ${snapshot}`)
      return value
    }
    await call('browser_act', {
      actions: [
        { do: 'fill', ref: ref('Email'), value: 'user1@example.test' },
        { do: 'fill', ref: ref('Name'), value: 'User 1' },
        { do: 'click', ref: ref('Create customer') },
      ],
    })
    expect(JSON.parse((await call('recording', {}))[0]?.text ?? '[]')).toHaveLength(4)
    const adopted = JSON.parse(
      (
        await call('run_adopt', {
          workflow: f.wf.name,
          params: { input: f.input },
          data: { Email: 'user1@example.test', Name: 'User 1' },
          note: 'Recorded first row; matching server confirmation',
        })
      )[0]?.text ?? '{}',
    )
    expect(adopted.status).toBe('done')
    const image = await client.callTool({
      name: 'document_image',
      arguments: { file: adopted.report.items[0].evidence },
    })
    const pixels = (image.content as { type: string; data: string; mimeType: string }[])[0]
    if (!pixels) throw new Error('Missing MCP image content')
    expect(pixels.type).toBe('image')
    expect(pixels.mimeType).toBe('image/png')
    expect(Buffer.from(pixels.data, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
    const outside = join(f.root, 'outside.png')
    writeFileSync(outside, Buffer.from(pixels.data, 'base64'))
    expect((await client.callTool({ name: 'document_image', arguments: { file: outside } })).isError).toBe(
      true,
    )
    const replay = JSON.parse(
      (await call('run_start', { workflow: f.wf.name, params: { input: f.input } }))[0]?.text ?? '{}',
    )
    expect(replay.report.counts).toEqual({ skipped: 1, done: 1 })
    expect(f.site.submissions).toHaveLength(2)
  })

  it('journals the recorded first row before replaying the full CSV', async () => {
    const f = await fixture()
    const page = await f.browser.page()
    await page.goto(`${f.site.url}/form`)
    await page.getByLabel('Email').fill('user1@example.test')
    await page.getByLabel('Name').fill('User 1')
    await page.getByRole('button', { name: 'Create customer' }).click()
    const adopted = await f.runner.adopt(
      f.wf.name,
      { input: f.input },
      { Email: 'user1@example.test', Name: 'User 1' },
      'Recorded first row and observed matching confirmation',
    )
    expect(adopted.status).toBe('done')
    expect((await f.runner.start(f.wf.name, { input: f.input })).report.counts).toEqual({
      skipped: 1,
      done: 2,
    })
    expect(f.site.submissions).toHaveLength(3)
    expect(new Set(f.site.submissions.map((s) => s.Email)).size).toBe(3)
  })

  it('replays a CSV once and skips its second run', async () => {
    const f = await fixture()
    const first = await f.runner.start(f.wf.name, { input: f.input })
    expect(first.status).toBe('done')
    expect(first.report.counts).toEqual({ done: 3 })
    for (const item of first.report.items)
      expect(readFileSync(item.evidence as string).length).toBeGreaterThan(100)
    expect((await f.runner.start(f.wf.name, { input: f.input })).report.counts).toEqual({ skipped: 3 })
    expect(f.site.submissions).toEqual(
      Array.from({ length: 3 }, (_, i) => ({ Email: `user${i + 1}@example.test`, Name: `User ${i + 1}` })),
    )
  })

  it('repairs selectors and fills the entire form before submitting', async () => {
    const f = await fixture(2, true)
    const paused = await f.runner.start(f.wf.name, { input: f.input })
    expect(paused.status).toBe('needs_repair')
    expect(f.site.submissions).toHaveLength(0)
    await f.runner.repair(paused.report.runId, 'email', label('Email'))
    expect((await f.runner.resume(paused.report.runId)).status).toBe('done')
    expect(f.site.submissions.map((s) => s.Name)).toEqual(['User 1', 'User 2'])
  })

  it('blocks successful submissions whose confirmation failed, even with repeat', async () => {
    const f = await fixture(2)
    f.site.failConfirmation()
    const first = await f.runner.start(f.wf.name, { input: f.input })
    expect(first.status).toBe('partial')
    expect(first.report.counts).toEqual({ review: 2 })
    const next = await f.runner.start(f.wf.name, { input: f.input }, { repeat: true })
    expect(next.report.counts).toEqual({ review: 2 })
    expect(f.site.submissions).toHaveLength(2)
  })

  it('shares Chrome across clients without closing the other connection', async () => {
    const f = await fixture(1)
    const first = await f.browser.page()
    await first.goto(`${f.site.url}/form`)
    const second = new Browser({ profile: join(f.root, 'profile'), headless: true })
    try {
      expect((await second.page()).url()).toBe(first.url())
      await second.close()
      expect(await first.title()).toBe('Ritoko Lab')
    } finally {
      await second.close()
    }
  })

  it('repairs final checks after disconnecting without rerunning setup or submitting', async () => {
    const f = await fixture(1)
    await f.store.save({
      ...f.wf,
      teardown: [{ id: 'final', do: 'expect', target: label('Old result'), timeoutMs: 100 }],
    })
    const paused = await f.runner.start(f.wf.name, { input: f.input })
    expect(paused.status).toBe('needs_repair')
    expect(paused.report.counts).toEqual({ done: 1 })
    await f.runner.repair(paused.report.runId, 'final', {
      primary: { by: 'text', text: 'Created user1@example.test', exact: false },
      fallbacks: [],
    })
    const before = (await f.browser.page()).url()
    await f.browser.close()
    const second = new Browser({ profile: join(f.root, 'profile'), headless: true })
    try {
      const cold = new Runner(second, f.ledger, f.store, join(f.root, 'runs'))
      expect((await cold.resume(paused.report.runId)).status).toBe('done')
      expect((await second.page()).url()).toBe(before)
      expect(f.site.submissions).toHaveLength(1)
    } finally {
      await second.close()
    }
  })

  it('extracts a table in setup and processes its rows as the batch', async () => {
    const f = await fixture(0)
    await f.store.save({
      ...f.wf,
      name: 'copy-customers',
      items: { from: '{{files.customers.csv}}', key: '{{item.Email}}', scope: '{{param.base}}' },
      params: { base: { description: 'site', default: f.site.url } },
      setup: [
        { id: 'list', do: 'goto', url: '{{param.base}}/customers' },
        {
          id: 'export',
          do: 'extract',
          target: { primary: { by: 'role', role: 'table', name: 'Customers' }, fallbacks: [] },
          saveAs: 'customers.csv',
        },
      ],
      item: f.wf.item.map((s) => (s.id === 'name' ? { ...s, value: '{{item.Contact Name}}' } : s)),
    })
    const result = await f.runner.start('copy-customers')
    expect(result.status).toBe('done')
    expect(readFileSync(result.report.files['customers.csv'] as string, 'utf8')).toBe(
      [
        'Email,Contact Name,Contact Note,Column 4',
        'user1@example.test,User 1,"says ""hi"", ok",Edit',
        'user2@example.test,User 2,a b,',
        'user3@example.test,User 3,,',
        '',
      ].join('\r\n'),
    )
    expect(f.site.submissions.map((s) => s.Name)).toEqual(['User 1', 'User 2', 'User 3'])
  })

  it('confines malicious download filenames and preserves their actual contents', async () => {
    const f = await fixture(1)
    const page = await f.browser.page()
    await page.goto(`${f.site.url}/export`)
    const file = await download(page, page.getByRole('link', { name: 'Export' }), f.root)
    expect(dirname(file)).toBe(f.root)
    expect(readFileSync(file, 'utf8')).toContain('a@example.test')
  })

  it('survives killing the CLI after server acceptance: ten unique sends and one review', async () => {
    const f = await fixture(10)
    const accepted = f.site.hold('user3@example.test')
    const child = spawn(
      process.execPath,
      ['src/cli.ts', 'run', f.wf.name, '--param', `input=${f.input}`, '--headless'],
      {
        cwd: resolve('.'),
        env: { ...process.env, RITOKO_HOME: f.root },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    let output = ''
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    const ended = once(child, 'close')
    try {
      await Promise.race([
        accepted,
        ended.then(() => {
          throw new Error(`CLI exited before crash point: ${output}`)
        }),
      ])
      child.kill('SIGKILL')
      await ended
      f.site.release()
      const run = f.ledger.lastRun(f.wf.name)
      expect(run).toBeDefined()
      const resumed = await f.runner.resume(run?.id ?? '')
      expect(resumed.status).toBe('partial')
      expect(resumed.report.counts).toEqual({ done: 9, review: 1 })
      expect(f.site.submissions).toHaveLength(10)
      expect(new Set(f.site.submissions.map((s) => s.Email)).size).toBe(10)
      expect(f.site.submissions.every((s) => s.Name)).toBe(true)
      const rerun = await f.runner.start(f.wf.name, { input: f.input })
      expect(rerun.report.counts).toEqual({ skipped: 9, review: 1 })
      expect(f.site.submissions).toHaveLength(10)
      await f.runner.resolve(
        resumed.report.runId,
        'user3@example.test',
        'done',
        'Lab server contains the exact email and name',
      )
      expect((await f.runner.resume(resumed.report.runId)).status).toBe('done')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await ended
      }
      f.site.release()
    }
  })
})
