import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { agentArgs, type Call, finishMcp } from '../src/engine/integrations.ts'
import { processAlive } from '../src/engine/ledger.ts'
import { claudeServer } from '../src/engine/mcp-client.ts'
import { Workflow, type WorkflowInput } from '../src/engine/schema.ts'
import type { Scope } from '../src/engine/template.ts'
import { api } from './support/api.ts'
import { harness } from './support/harness.ts'
import { mcpOverHttp } from './support/mcp-http.ts'

const FIXTURE = fileURLToPath(new URL('./support/mcp-fixture.ts', import.meta.url))
const escaped = (text: string) => JSON.stringify(text).slice(1, -1)
/** Claude Code's own syntax for an environment variable in its configuration: ${NAME} or ${NAME:-default}. */
const claudeVar = (name: string, fallback?: string) =>
  `\${${name}${fallback === undefined ? '' : `:-${fallback}`}}`
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const undo of cleanup.splice(0).reverse()) await undo()
})

/** Sets an environment variable for the length of the test. */
function setEnv(name: string, value: string) {
  const before = process.env[name]
  process.env[name] = value
  cleanup.push(() => {
    if (before === undefined) delete process.env[name]
    else process.env[name] = before
  })
}

const call = (id: string, tool: string, more: Record<string, unknown> = {}) => ({
  id,
  do: 'mcp' as const,
  server: 'fixture',
  tool,
  readOnly: true,
  ...more,
})
/** The step that makes a read-only item verifiable. */
const echo = call('echo', 'echo', {
  args: { message: 'hi {{item.Name}}' },
  expect: { json: { '/echo': 'hi {{item.Name}}' } },
})

/** Items served by the fixture server, started by the workflow itself. */
async function fixture(item: WorkflowInput['item'], more: Partial<WorkflowInput> = {}, rows?: string) {
  const f = harness(rows)
  const dir = join(f.root, 'tool-files')
  mkdirSync(dir)
  const { workflow: wf } = await f.save({
    name: 'tools',
    description: 'test',
    readOnly: true,
    params: { input: {}, dir: { default: dir }, file: { required: false } },
    servers: {
      fixture: { command: process.execPath, args: [FIXTURE], env: { FIXTURE_DIR: '{{param.dir}}' } },
    },
    items: { from: '{{param.input}}', key: '{{item.Email}}' },
    item,
    ...more,
  })
  const start = (params: Record<string, string> = {}) =>
    f.runner.start(wf.name, { input: f.input, ...params })
  return { ...f, dir, wf, start }
}

describe('mcp steps', () => {
  it('calls tools with templated arguments, saves values and closes the server at the end of the run', async () => {
    const f = await fixture([
      echo,
      call('who', 'pid', { save: { pid: '/pid' } }),
      call('say', 'echo', { args: { message: 'x' }, save: { said: '/echo' } }),
    ])
    const done = await f.start()
    expect(done.report.counts).toEqual({ done: 2 })
    expect(f.browser.launched).toBe(0)
    const [first, second] = f.ledger.items(done.report.runId)
    expect(first?.vars.said).toBe('x')
    // One server process served both items.
    expect(first?.vars.pid).toBe(second?.vars.pid)
    const pid = Number(first?.vars.pid)
    expect(pid).toBeGreaterThan(0)
    for (let i = 0; i < 100 && processAlive(pid); i++) await delay(50)
    expect(processAlive(pid)).toBe(false)
    const events = f.ledger.db.prepare("SELECT detail FROM events WHERE kind = 'mcp'").all()
    expect(JSON.parse(String(events[0]?.detail))).toEqual({
      item: 'a@example.test',
      step: 'echo',
      server: 'fixture',
      tool: 'echo',
      saved: [],
    })
  })

  it('reads a text result as JSON when it parses, else as {text}', async () => {
    const f = await fixture(
      [
        call('plain', 'plain', { save: { words: '/text' } }),
        call('json', 'jsontext', { save: { b: '/a/b', all: '' }, expect: { json: { '/a/b': '7' } } }),
      ],
      {},
      'Email\na@example.test\n',
    )
    const done = await f.start()
    expect(done.report.counts).toEqual({ done: 1 })
    expect(f.ledger.items(done.report.runId)[0]?.vars).toEqual({
      words: 'plain words',
      b: '7',
      all: '{"a":{"b":7}}',
    })
  })

  it('keeps the file of a result: an image, a path, a file: link or a web link', async () => {
    const site = await api()
    cleanup.push(() => site.close())
    const f = await fixture(
      [
        echo,
        call('image', 'image', { saveAs: '{{item.Name}}' }),
        call('doc', 'path', { args: { name: '{{item.Name}}' }, file: '/path', saveAs: '{{item.Name}}-doc' }),
        call('link', 'link', { saveAs: 'link' }),
        call('web', 'link', { args: { uri: '{{param.file}}' }, saveAs: '{{item.Name}}-web' }),
      ],
      {},
      'Email,Name\na@example.test,Ada\nb@example.test,Bob\n',
    )
    const done = await f.start({ file: `${site.url}/file` })
    expect(done.report.counts).toEqual({ done: 2 })
    expect(
      readdirSync(done.report.dir)
        .filter((n) => !n.endsWith('.db'))
        .sort(),
    ).toEqual([
      'Ada-doc.txt',
      'Ada-web.png',
      'Ada.png',
      'Bob-doc.txt',
      'Bob-web.png',
      'Bob.png',
      'link (2).bin',
      'link.bin',
    ])
    expect(readFileSync(join(done.report.dir, 'Ada.png'))).toEqual(Buffer.from([137, 80, 78, 71, 1]))
    expect(readFileSync(join(done.report.dir, 'Bob-doc.txt'), 'utf8')).toBe('made for Bob')
    expect(readFileSync(join(done.report.dir, 'Bob-web.png'))).toEqual(Buffer.from([0, 1, 2, 255]))
    // The tool's own file is copied, not moved.
    expect(readFileSync(join(f.dir, 'made-Ada.txt'), 'utf8')).toBe('made for Ada')
    expect(done.report.files['Ada.png']).toBe(join(done.report.dir, 'Ada.png'))
  })

  it('fails a tool error before the commit and holds it for review after', async () => {
    const f = await fixture([echo, call('boom', 'fail')], {}, 'Email,Name\na@example.test,Ada\n')
    const before = await f.start()
    expect(before.report.items[0]).toMatchObject({ status: 'failed', cause: 'system' })
    expect(before.report.items[0]?.message).toContain('MCP tool "fail" failed (isError: true)')
    expect(f.dump()).not.toContain('the tool refused')
    expect(f.ledger.items(before.report.runId)[0]?.committed).toBe(false)

    const commit = call('send', 'fail', {
      commit: true,
      readOnly: false,
      expect: { json: { '/ok': 'true' } },
    })
    const g = await fixture([commit], { readOnly: false }, 'Email,Name\na@example.test,Ada\n')
    const after = await g.start()
    expect(after.report.items[0]).toMatchObject({ status: 'review', cause: 'system' })
    expect(g.ledger.items(after.report.runId)[0]?.committed).toBe(true)
    // Once the commit started, the item is never replayed.
    expect((await g.runner.resume(after.report.runId)).report.counts).toEqual({ review: 1 })
  })

  it('fails on a tool that wants more input, an unknown tool and a server that cannot start', async () => {
    const f = await fixture([echo, call('ask', 'ask')], {}, 'Email,Name\na@example.test,Ada\n')
    expect((await f.start()).report.items[0]?.message).toContain('asks for more input')
    const g = await fixture([echo, call('nope', 'nope')], {}, 'Email,Name\na@example.test,Ada\n')
    expect((await g.start()).report.items[0]?.message).toContain('has no tool "nope" (it has echo,')
    const h = await fixture(
      [echo],
      {
        servers: {
          fixture: { command: process.execPath, args: [FIXTURE], env: { FIXTURE_FAIL_START: '1' } },
        },
      },
      'Email,Name\na@example.test,Ada\n',
    )
    expect((await h.start()).report.items[0]?.message).toContain('fixture exploded on start')
  })

  it('converts strings to the numbers and booleans the tool declares, when they read cleanly', async () => {
    const typed = call('typed', 'typed', {
      args: { count: '{{item.N}}', flag: 'true', label: '{{item.N}}' },
      expect: { json: { '/kinds': 'number/boolean/string', '/label': '007' } },
    })
    const f = await fixture([typed], {}, 'Email,N\na@example.test,007\nb@example.test,abc\n')
    const done = await f.start()
    // "007" is a number for count and stays text for label; "abc" is left as it is, and the tool refuses it.
    expect(done.report.items.map((i) => i.status)).toEqual(['done', 'failed'])
    expect(done.report.items[1]?.message).toContain('MCP tool "typed" failed')
  })

  it('waits for progress: a silent tool times out, one that reports progress does not', async () => {
    const silent = call('silent', 'slow', { args: { ms: 1000, progress: false }, timeoutMs: 400 })
    const f = await fixture([echo, silent], {}, 'Email,Name\na@example.test,Ada\n')
    expect((await f.start()).report.items[0]?.message).toContain('gave no answer or progress within 0.4 s')
    const busy = call('busy', 'slow', {
      args: { ms: 1000, progress: true },
      timeoutMs: 500,
      expect: { json: { '/slow': 'done' } },
    })
    const g = await fixture([busy], {}, 'Email,Name\na@example.test,Ada\n')
    expect((await g.start()).report.counts).toEqual({ done: 1 })
  })

  it('connects to a server by URL, with headers filled from a secret param', async () => {
    const remote = await mcpOverHttp()
    cleanup.push(() => remote.close())
    setEnv('RITOKO_TEST_MCP_KEY', 'mcp-key-12345')
    const f = await fixture(
      [echo],
      {
        params: { input: {}, key: { secret: true, env: 'RITOKO_TEST_MCP_KEY' } },
        servers: { fixture: { url: remote.url, headers: { Authorization: 'Bearer {{param.key}}' } } },
      },
      'Email,Name\na@example.test,Ada\n',
    )
    const done = await f.start()
    expect(done.report.counts).toEqual({ done: 1 })
    expect(remote.authorizations.length).toBeGreaterThan(1)
    expect(new Set(remote.authorizations)).toEqual(new Set(['Bearer mcp-key-12345']))
    expect(f.dump()).not.toContain('mcp-key-12345')
  })

  it('refuses a claimed read when the tool explicitly advertises writes, before committing', async () => {
    const f = await fixture([echo, call('writes', 'writes')], {}, 'Email,Name\na@example.test,Ada\n')
    const result = await f.start()
    expect(result.report.items[0]?.message).toContain('declares that it writes')
    expect(f.ledger.items(result.report.runId)[0]?.committed).toBe(false)
  })

  it('requires host mode for an agent-managed server before creating a direct run', async () => {
    const f = await fixture([echo], { servers: { fixture: { ref: 'agent' } } })
    await expect(f.start()).rejects.toThrow('requires host mode')
    expect(f.ledger.lastRun()).toBeUndefined()
    expect(f.browser.launched).toBe(0)
  })

  it('shares result verification with host mode and refuses secret agent arguments', async () => {
    const step = Workflow.parse({ name: 'x', description: 'x', item: [echo] }).item[0]
    if (step?.do !== 'mcp') throw new Error('Expected mcp fixture')
    const scope: Scope = { param: {}, item: { Name: 'Ada' }, files: {}, vars: {}, secrets: ['private-key'] }
    const request = { scope, dir: '', commit: () => {}, identity: 'test' } as Call
    expect(agentArgs(step, scope)).toEqual({ message: 'hi Ada' })
    await expect(finishMcp(step, { content: [], isError: true }, request)).rejects.toThrow(
      'MCP tool "echo" failed',
    )
    await expect(finishMcp(step, { content: [], resultType: 'input_required' }, request)).rejects.toThrow(
      'asks for more input',
    )
    expect(() => agentArgs({ ...step, args: { text: 'private-key' } }, scope)).toThrow('uses a secret')
    const done = await finishMcp(step, { content: [], structuredContent: { echo: 'hi Ada' } }, request)
    expect(done.evidence.saved).toEqual([])
  })

  it('masks a configured credential in server startup errors and stderr', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ritoko-test-claude-'))
    cleanup.push(() => rmSync(home, { recursive: true, force: true }))
    setEnv('CLAUDE_CONFIG_DIR', home)
    const secret = 'server-start-credential'
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [FIXTURE],
            env: { FIXTURE_FAIL_START: '1', SECRET_VALUE: secret },
          },
        },
      }),
    )
    const f = await fixture(
      [echo],
      { servers: { fixture: { ref: 'claude' } } },
      'Email,Name\na@example.test,Ada\n',
    )
    const result = await f.start()
    expect(result.report.items[0]?.message).toContain('fixture exploded on start ***')
    expect(JSON.stringify(result).includes(secret)).toBe(false)
    expect(f.dump().includes(secret)).toBe(false)
  })

  it("resolves ref: 'claude' from Claude Code's configuration and never stores what it holds", async () => {
    const home = mkdtempSync(join(tmpdir(), 'ritoko-test-claude-'))
    cleanup.push(() => rmSync(home, { recursive: true, force: true }))
    setEnv('CLAUDE_CONFIG_DIR', home)
    setEnv('RITOKO_TEST_FIXTURE', FIXTURE)
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            type: 'stdio',
            command: process.execPath,
            args: [claudeVar('RITOKO_TEST_FIXTURE')],
            env: { SECRET_VALUE: 'sk-live-0123456789', FIXTURE_DIR: claudeVar('RITOKO_TEST_DIR', '.') },
          },
        },
      }),
    )
    const reveal = call('reveal', 'env', { args: { name: 'SECRET_VALUE' }, save: { secret: '/value' } })
    const f = await fixture(
      [echo, reveal],
      { servers: { fixture: { ref: 'claude' } } },
      'Email,Name\na@example.test,Ada\n',
    )
    const done = await f.start()
    // The server got the value (it answered), and Ritoko masked it everywhere it keeps things.
    expect(done.report.counts).toEqual({ done: 1 })
    expect(f.ledger.items(done.report.runId)[0]?.vars.secret).toBeUndefined()
    for (const kept of [f.dump(), readFileSync(join(f.root, 'workflows', 'tools.json'), 'utf8')]) {
      expect(kept).not.toContain('sk-live-0123456789')
      expect(kept).not.toContain(escaped(FIXTURE))
      expect(kept).not.toContain(escaped(process.execPath))
    }
  })

  it("reads Claude Code's configuration: local, then project, then user scope", async () => {
    const home = mkdtempSync(join(tmpdir(), 'ritoko-test-claude-'))
    const cwd = mkdtempSync(join(tmpdir(), 'ritoko-test-claude-'))
    cleanup.push(() => {
      rmSync(home, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    })
    setEnv('CLAUDE_CONFIG_DIR', home)
    setEnv('RITOKO_TEST_Y', 'why')
    delete process.env.RITOKO_TEST_X
    delete process.env.RITOKO_TEST_Z
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          a: { command: 'user-a' },
          b: {
            command: 'user-b',
            args: [claudeVar('RITOKO_TEST_X', 'dflt'), claudeVar('RITOKO_TEST_Y')],
            env: { K: 'v' },
          },
          c: {
            type: 'http',
            url: `https://${claudeVar('RITOKO_TEST_X', 'example.test')}/mcp`,
            headers: { Authorization: `Bearer ${claudeVar('RITOKO_TEST_Y')}` },
          },
          d: { command: 'needs', args: [claudeVar('RITOKO_TEST_Z')] },
          e: { type: 'sse', url: 'https://example.test/sse' },
        },
        projects: { [cwd.replaceAll('\\', '/')]: { mcpServers: { a: { command: 'local-a' } } } },
      }),
    )
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'project-a' } } }))
    expect(await claudeServer('a', cwd)).toMatchObject({ command: 'local-a' })
    writeFileSync(join(cwd, '.mcp.json'), '{}')
    expect(await claudeServer('a', cwd)).toMatchObject({ command: 'local-a' })
    expect(await claudeServer('a', join(cwd, 'other'))).toMatchObject({ command: 'user-a' })
    expect(await claudeServer('b', cwd)).toEqual({
      command: 'user-b',
      args: ['dflt', 'why'],
      env: { K: 'v' },
    })
    expect(await claudeServer('c', cwd)).toEqual({
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer why' },
    })
    await expect(claudeServer('d', cwd)).rejects.toThrow('Set environment variable RITOKO_TEST_Z')
    await expect(claudeServer('e', cwd)).rejects.toThrow('not a stdio or HTTP server')
    await expect(claudeServer('missing', cwd)).rejects.toThrow('is not in Claude Code')
    writeFileSync(join(cwd, '.mcp.json'), '{ "mcpServers": ')
    await expect(claudeServer('b', cwd)).rejects.toThrow('is not valid JSON')
  })
})
