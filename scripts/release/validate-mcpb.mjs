import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Usage: node scripts/release/validate-mcpb.mjs [bundle.mcpb]
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkgSource = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'))
const release = join(sourceRoot, '.ritoko', `release-${pkgSource.version}`)
const toolsDir = resolve(process.env.MCPB_TOOLS_DIR || join(sourceRoot, '.ritoko/mcpb-tools'))
assert.equal(
  JSON.parse(readFileSync(join(toolsDir, 'node_modules/@anthropic-ai/mcpb/package.json'), 'utf8')).version,
  '2.1.2',
)
const prefix = resolve(tmpdir(), 'ritoko-mcpb-smoke-')
const root = mkdtempSync(prefix)
const bundle = join(root, 'bundle')
const cli = join(toolsDir, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js')
const output = resolve(process.argv[2] || join(release, `${pkgSource.name}-${pkgSource.version}.mcpb`))
let client
let service
function command(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NODE_PATH: '' },
  })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  return result.stdout
}
try {
  command([cli, 'unpack', output, bundle])
  const validation = command([cli, 'validate', join(bundle, 'manifest.json')])
  writeFileSync(join(release, 'mcpb-validation.log'), validation)
  const inventory = JSON.parse(readFileSync(join(release, 'mcpb-source-inventory.json'), 'utf8'))
  // The official packer excludes declarations/maps/config files that are not runtime dependencies.
  const { shouldExclude } = await import(
    pathToFileURL(join(toolsDir, 'node_modules/@anthropic-ai/mcpb/dist/node/files.js')).href
  )
  const packedInventory = inventory.files.filter((file) => !shouldExclude(file.path))
  const bundledPaths = new Set()
  function inspect(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      assert(!entry.isSymbolicLink())
      if (entry.isDirectory()) inspect(path)
      else bundledPaths.add(relative(bundle, path).replaceAll('\\', '/'))
    }
  }
  inspect(bundle)
  for (const { path, sha256 } of packedInventory) {
    assert(bundledPaths.delete(path), `Missing ${path}`)
    assert.equal(
      createHash('sha256')
        .update(readFileSync(join(bundle, path)))
        .digest('hex'),
      sha256,
      path,
    )
  }
  assert.equal(bundledPaths.size, 0, 'Unallowlisted files in MCPB')
  writeFileSync(join(release, 'mcpb-packed-inventory.json'), JSON.stringify(packedInventory, null, 2))
  for (const name of ['vitest', 'typescript', '@biomejs/biome'])
    assert(!existsSync(join(bundle, 'node_modules', name)))
  const require = createRequire(join(bundle, 'package.json'))
  const { Client } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href
  )
  const { StdioClientTransport } = await import(
    pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
  )
  const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8'))
  assert.equal(manifest.compatibility.runtimes.node, '>=24.0.0')
  assert.equal(manifest.server.mcp_config.command, 'node')
  // biome-ignore lint/suspicious/noTemplateCurlyInString: MCPB launch substitution is deliberately literal.
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/bin/ritoko.mjs', 'mcp'])
  const home = join(root, 'home')
  const input = join(root, 'input.csv')
  writeFileSync(input, 'ID\none\ntwo\n')
  let requests = 0
  service = createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'verified' }))
  })
  await new Promise((done) => service.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${service.address().port}/verify`
  client = new Client({ name: 'ritoko-mcpb-smoke', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Emulate MCPB launch substitution in the extracted bundle.
    args: manifest.server.mcp_config.args.map((arg) => arg.replaceAll('${__dirname}', bundle)),
    cwd: root,
    env: {
      ...process.env,
      NODE_PATH: '',
      RITOKO_HOME: home,
      RITOKO_BROWSER: 'clean',
      RITOKO_CHROME_PATH: join(root, 'missing-chrome'),
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk
  })
  await client.connect(transport)
  assert.equal(client.getServerVersion().version, pkg.version)
  assert.equal(pkg.version, pkgSource.version)
  const tools = (await client.listTools()).tools
  assert.equal(tools.length, 20)
  for (const name of ['workflow_save', 'run_start', 'run_report', 'host_start', 'host_next'])
    assert(
      tools.some((tool) => tool.name === name),
      name,
    )
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args })
    assert(!result.isError, JSON.stringify(result.content))
    return JSON.parse(result.content[0].text)
  }
  await call('workflow_save', {
    workflow: {
      name: 'bundle-probe',
      description: 'MCPB local API-only smoke',
      readOnly: true,
      params: { input: {} },
      items: { from: '{{param.input}}', key: '{{item.ID}}', scope: url },
      item: [{ do: 'http', url, expect: { json: { '/status': 'verified' } } }],
    },
  })
  assert.deepEqual((await call('run_start', { workflow: 'bundle-probe', params: { input } })).counts, {
    done: 2,
  })
  assert.deepEqual((await call('run_start', { workflow: 'bundle-probe', params: { input } })).counts, {
    skipped: 2,
  })
  assert.equal(requests, 2)
  assert.deepEqual(readdirSync(join(home, 'profile')), [])
  assert(!stderr.includes('installing runtime dependencies'), stderr)
  assert(tools.every((tool) => tool.name && tool.description && tool.inputSchema?.type === 'object'))
  writeFileSync(
    join(release, 'server-card.json'),
    JSON.stringify({ serverInfo: client.getServerVersion(), tools, resources: [], prompts: [] }, null, 2) +
      '\n',
  )
  const result = {
    limitations: [
      'Tested on the recorded Node runtime and operating system only',
      'No desktop MCP client compatibility tested',
    ],
    artifact: output,
    node: process.versions.node,
    platformTested: process.platform,
    mcpVersion: pkg.version,
    tools: tools.map((tool) => tool.name),
    toolCount: tools.length,
    verified: 2,
    skipped: 2,
    requests,
    chrome: false,
    devDependencies: false,
    files: packedInventory.length,
    sourceSha256: inventory.sourceSha256,
    sourceIntegrity: inventory.sourceIntegrity,
    sourceLockSha256: inventory.sourceLockSha256,
    toolingVersion: inventory.toolingVersion,
    serverCardSha256: createHash('sha256')
      .update(readFileSync(join(release, 'server-card.json')))
      .digest('hex'),
    bundleSha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
  }
  writeFileSync(join(release, 'mcpb-smoke.json'), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(
    join(release, 'SHA256SUMS'),
    `${[`${result.sourceSha256}  ${basename(inventory.source)}`, `${result.bundleSha256}  ${basename(output)}`, `${result.serverCardSha256}  server-card.json`].join('\n')}\n`,
  )
  console.log(JSON.stringify(result))
} finally {
  await client?.close()
  if (service) {
    service.closeAllConnections()
    await new Promise((done) => service.close(done))
  }
  assert(
    dirname(root) === dirname(prefix) && basename(root).startsWith(basename(prefix)),
    'Unsafe temporary cleanup path',
  )
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
