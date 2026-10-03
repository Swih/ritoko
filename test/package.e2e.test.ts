import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { api } from './support/api.ts'

const temporaryPrefix = resolve(tmpdir(), 'ritoko-package-e2e-')
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    const absolute = resolve(root)
    if (
      dirname(absolute) !== dirname(temporaryPrefix) ||
      !basename(absolute).startsWith(basename(temporaryPrefix))
    )
      throw new Error(`Unsafe package test cleanup: ${absolute}`)
    rmSync(absolute, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})

function npmCli() {
  const suffix = join('node_modules', 'npm', 'bin', 'npm-cli.js')
  const prefix = dirname(dirname(process.execPath))
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), suffix),
    join(prefix, 'lib', suffix),
    join(prefix, 'libexec', 'lib', suffix),
    ...(process.env.PATH ?? '').split(delimiter).map((entry) => join(entry, suffix)),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ]
  // pnpm/yarn also set npm_execpath; only npm's own CLI implements npm pack --json.
  const cli = candidates.find(
    (candidate): candidate is string =>
      !!candidate && basename(candidate) === 'npm-cli.js' && existsSync(candidate),
  )
  if (!cli) throw new Error('Cannot find npm-cli.js for packaged distribution test')
  return cli
}

function node(args: string[], cwd: string, home: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        RITOKO_HOME: home,
        RITOKO_BROWSER: 'clean',
        RITOKO_CHROME_PATH: join(home, 'missing-chrome-executable'),
        NODE_PATH: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Packaged command timed out: ${args.join(' ')}\n${stderr}`))
    }, 60_000)
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

// This program runs in the clean consumer directory. Its SDK and server both resolve
// from the installed tarball's runtime dependencies, outside the source checkout.
const protocolSmoke = `
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const [launcher, input, base] = process.argv.slice(2)
const client = new Client({ name: 'ritoko-package-smoke', version: '1.0.0' })
const transport = new StdioClientTransport({ command: process.execPath, args: [launcher, 'mcp'], cwd: process.cwd(), env: { ...process.env }, stderr: 'pipe' })
let stderr = ''
transport.stderr?.on('data', (chunk) => { stderr += chunk })
try {
  await client.connect(transport)
  const installedPackage = JSON.parse(readFileSync(new URL('./node_modules/ritoko/package.json', import.meta.url), 'utf8'))
  assert.equal(client.getServerVersion()?.version, installedPackage.version)
  const names = (await client.listTools()).tools.map((tool) => tool.name)
  for (const name of ['workflow_save', 'run_start', 'run_report', 'host_start', 'host_next']) assert(names.includes(name), name)
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    assert(!result.isError, JSON.stringify(result.content))
    return JSON.parse(result.content[0].text)
  }
  const workflow = {
    name: 'packaged-orders', description: 'Tarball runtime smoke',
    params: { input: {} }, items: { from: '{{param.input}}', key: '{{item.Email}}', scope: base },
    item: [
      { id: 'create', do: 'http', method: 'POST', url: base + '/orders', body: { json: { email: '{{item.Email}}' } }, commit: true, expect: { status: [201] }, save: { orderId: '/id' } },
      { id: 'verify', do: 'http', url: base + '/orders/{{vars.orderId}}', expect: { json: { '/status': 'paid' } } },
    ],
  }
  assert.equal((await call('workflow_save', { workflow })).name, workflow.name)
  const result = await call('run_start', { workflow: workflow.name, params: { input } })
  assert.equal(result.status, 'done')
  assert.deepEqual(result.counts, { done: 2 })
  assert.deepEqual((await call('run_start', { workflow: workflow.name, params: { input } })).counts, { skipped: 2 })
  const report = await call('run_report', { runId: result.runId, items: 'all' })
  assert.equal(report.items.length, 2)
  assert(report.items.every((item) => item.status === 'done'))
  // The host workflow uses only HTTP, so it needs no browser or external agent actions.
  await call('workflow_save', { workflow: { ...workflow, name: 'packaged-host', readOnly: true, item: [{ do: 'http', url: base + '/token', expect: { json: { '/token': 't-123' } } }], items: { ...workflow.items, scope: base + '/host' } } })
  let host = await call('host_start', { workflow: 'packaged-host', params: { input } })
  for (let i = 0; !host.done && i < 5; i++) {
    assert.deepEqual(host.actions, [])
    host = await call('host_next', { runId: host.runId, batch: host.batch, results: [] })
  }
  assert.equal(host.done.status, 'done')
  assert.deepEqual(host.done.counts, { done: 2 })
  console.log(JSON.stringify({ tools: names.length, direct: result.status, host: host.done.status }))
} finally {
  await client.close()
  assert(!stderr.includes('installing runtime dependencies'), stderr)
}
`

it('runs the npm tarball using only installed runtime dependencies, CLI and stdio MCP without Chrome', async () => {
  const root = mkdtempSync(temporaryPrefix)
  roots.push(root)
  const home = join(root, 'home')
  const npm = npmCli()
  const packed = await node(
    [npm, 'pack', '--json', '--silent', '--pack-destination', root],
    resolve('.'),
    home,
  )
  expect(packed.code, packed.stderr).toBe(0)
  const manifest = Object.values(JSON.parse(packed.stdout)) as {
    filename: string
    integrity: string
    files: { path: string }[]
  }[]
  const tarball = manifest[0]
  expect(tarball).toBeDefined()
  const paths = tarball?.files.map((file) => file.path) ?? []
  expect(paths).toEqual(
    expect.arrayContaining([
      'dist/cli.js',
      'dist/mcp/server.js',
      'dist/engine/host.js',
      'dist/engine/http.js',
      'dist/engine/mcp-client.js',
      'dist/engine/network.js',
    ]),
  )
  expect(paths.some((path) => path.startsWith('src/') || path.startsWith('test/'))).toBe(false)
  const tarballPath = `file:${join(root, tarball?.filename ?? '').replaceAll('\\', '/')}`
  const consumer = {
    name: 'ritoko-package-consumer',
    private: true,
    type: 'module',
    dependencies: { ritoko: tarballPath },
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(consumer))
  // Reuse the checked-in runtime lock graph so a cold install downloads only
  // pinned public tarballs. An existing npm cache supports an explicit offline run.
  const sourceLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))
  const packages = Object.fromEntries(
    Object.entries(sourceLock.packages as Record<string, { dev?: boolean }>).filter(
      ([path, entry]) => path && !entry.dev,
    ),
  )
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({
      name: consumer.name,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': consumer,
        ...packages,
        'node_modules/ritoko': {
          ...sourceLock.packages[''],
          resolved: tarballPath,
          integrity: tarball?.integrity,
          devDependencies: undefined,
        },
      },
    }),
  )
  const installed = await node(
    [
      npm,
      'ci',
      ...(process.env.RITOKO_TEST_NPM_OFFLINE === '1' ? ['--offline'] : []),
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    root,
    home,
  )
  expect(installed.code, installed.stderr).toBe(0)
  const packageRoot = join(root, 'node_modules', 'ritoko')
  const launcher = join(packageRoot, 'bin', 'ritoko.mjs')
  expect(existsSync(join(packageRoot, 'src'))).toBe(false)
  for (const dependency of ['vitest', 'typescript', '@biomejs/biome'])
    expect(existsSync(join(root, 'node_modules', dependency))).toBe(false)
  const list = await node([launcher, 'list'], root, home)
  expect(list.code, list.stderr).toBe(0)
  expect(list.stdout).toBe('')
  expect((await node([launcher, 'run'], root, home)).code).toBe(1)
  const input = join(root, 'input.csv')
  writeFileSync(input, 'Email\na@example.test\nb@example.test\n')
  const script = join(root, 'smoke.mjs')
  writeFileSync(script, protocolSmoke)
  const service = await api()
  try {
    const smoke = await node([script, launcher, input, service.url], root, home)
    expect(smoke.code, smoke.stderr).toBe(0)
    expect(JSON.parse(smoke.stdout)).toMatchObject({ direct: 'done', host: 'done' })
    expect(service.count('POST', '/orders')).toBe(2)
    expect(service.count('GET', '/orders/o-1')).toBe(1)
    expect(service.count('GET', '/orders/o-2')).toBe(1)
    expect(service.count('GET', '/token')).toBe(2)
    expect(
      service.seen.filter((request) => request.path === '/orders').map((request) => JSON.parse(request.body)),
    ).toEqual([{ email: 'a@example.test' }, { email: 'b@example.test' }])
    expect((await node([launcher, 'list'], root, home)).stdout).toContain('packaged-orders')
    const rerun = await node([launcher, 'run', 'packaged-orders', '--param', `input=${input}`], root, home)
    expect(rerun.code, rerun.stderr).toBe(0)
    expect(rerun.stdout).toContain('skipped 2')
    expect(service.count('POST', '/orders')).toBe(2)
    const failedWorkflow = join(root, 'failed.json')
    writeFileSync(
      failedWorkflow,
      JSON.stringify({
        name: 'packaged-failure',
        description: 'CLI failure exit status',
        readOnly: true,
        setup: [{ do: 'http', url: `${service.url}/not-found`, expect: { status: [200] } }],
      }),
    )
    expect((await node([launcher, 'import', failedWorkflow], root, home)).code).toBe(0)
    const failed = await node([launcher, 'run', 'packaged-failure'], root, home)
    expect(failed.code, failed.stderr).toBe(2)
    expect(failed.stdout).toContain('stopped')
    expect(readdirSync(join(home, 'profile'))).toEqual([])
    expect(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).name).toBe('ritoko')
  } finally {
    await service.close()
  }
}, 120_000)
