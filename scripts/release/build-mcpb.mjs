import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Usage: node scripts/release/build-mcpb.mjs [npm-pack.tgz]
// Install the official tooling separately: npm install --prefix .ritoko/mcpb-tools --ignore-scripts --save-exact @anthropic-ai/mcpb@2.1.2
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkgSource = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const release = join(root, '.ritoko', `release-${pkgSource.version}`)
mkdirSync(release, { recursive: true })
const staging = join(release, 'mcpb-stage')
const source = resolve(process.argv[2] || join(release, `${pkgSource.name}-${pkgSource.version}.tgz`))
const lockSource = join(root, 'package-lock.json')
const toolsDir = resolve(process.env.MCPB_TOOLS_DIR || join(root, '.ritoko/mcpb-tools'))
const toolPkg = JSON.parse(
  readFileSync(join(toolsDir, 'node_modules/@anthropic-ai/mcpb/package.json'), 'utf8'),
)
assert.equal(toolPkg.version, '2.1.2', 'Release tooling must be @anthropic-ai/mcpb@2.1.2')
const cli = join(toolsDir, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js')
const npmSuffix = 'node_modules/npm/bin/npm-cli.js'
const npm = [
  join(dirname(process.execPath), npmSuffix),
  join(dirname(dirname(process.execPath)), 'lib', npmSuffix),
].find(existsSync)
assert(npm, 'npm-cli.js required')
// This exact path is generated exclusively by this builder; rebuilding is safe.
assert.equal(resolve(staging), resolve(root, '.ritoko', `release-${pkgSource.version}`, 'mcpb-stage'))
rmSync(staging, { recursive: true, force: true })
const bytes = readFileSync(source)
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
function command(binary, args, cwd = release) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    env: { ...process.env, NODE_PATH: '' },
  })
  assert.equal(result.status, 0, `${binary} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}
const sourceEntries = command('tar', ['-tzf', source]).trim().split(/\r?\n/)
for (const entry of sourceEntries) {
  assert(entry.startsWith('package/') && !entry.includes('..'), entry)
  const path = entry.slice('package/'.length)
  assert(
    !/(?:^|\/)(?:\.ritoko|\.env[^/]*|\.npm|\.cache|node_modules|auth\.json|credentials\.json|journal\.(?:json|jsonl|db))(?=\/|$)/i.test(
      path,
    ),
    path,
  )
  assert(/^(?:bin\/|dist\/|skills\/|examples\/|README\.md$|LICENSE$|package\.json$)/.test(path), path)
}
mkdirSync(staging)
command('tar', ['-xzf', source, '-C', staging, '--strip-components=1'])
const pkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(lockSource, 'utf8'))
assert.equal(pkg.name, pkgSource.name)
assert.equal(pkg.version, pkgSource.version)
assert.equal(lock.version, pkg.version)
assert.equal(lock.packages[''].version, pkg.version)
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies)
writeFileSync(join(staging, 'package-lock.json'), JSON.stringify(lock))
command(
  process.execPath,
  [npm, 'ci', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'],
  staging,
)
rmSync(join(staging, 'package-lock.json'))
rmSync(join(staging, 'node_modules/.package-lock.json'), { force: true })
// npm's generated executable shims are unnecessary: the manifest launches Node directly.
const generatedBin = resolve(staging, 'node_modules/.bin')
assert(generatedBin === resolve(staging, 'node_modules', '.bin'))
rmSync(generatedBin, { recursive: true, force: true })
for (const name of ['vitest', 'typescript', '@biomejs/biome'])
  assert(!existsSync(join(staging, 'node_modules', name)), name)
assert(pkg.engines.node.includes('24'), 'Manifest requires Node >=24')
const manifest = {
  manifest_version: '0.3',
  name: 'ritoko',
  display_name: 'Ritoko',
  version: pkg.version,
  description: pkg.description,
  long_description:
    'Local, resumable browser and API workflows with a durable commit journal. Requires Node.js 24 or newer. API-only workflows do not need a browser; browser workflows require Google Chrome and access to its remote-debugging session, or an explicit dedicated Chrome session. Workflows, journals and evidence stay in the local ~/.ritoko directory by default. This bundle starts a local stdio MCP server and contains its production dependencies; it does not provide a remote endpoint.',
  author: { name: 'Swih', url: 'https://github.com/Swih' },
  repository: { type: 'git', url: 'https://github.com/Swih/ritoko.git' },
  homepage: 'https://ritoko.com',
  documentation: 'https://github.com/Swih/ritoko#readme',
  support: 'https://github.com/Swih/ritoko/issues',
  privacy_policies: ['https://github.com/Swih/ritoko/blob/main/docs/privacy.md'],
  license: 'MIT',
  keywords: ['browser', 'automation', 'workflow', 'mcp'],
  server: {
    type: 'node',
    entry_point: 'bin/ritoko.mjs',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: MCPB substitutes this literal at launch.
    mcp_config: { command: 'node', args: ['${__dirname}/bin/ritoko.mjs', 'mcp'] },
  },
  compatibility: { platforms: ['win32', 'darwin', 'linux'], runtimes: { node: '>=24.0.0' } },
  tools_generated: true,
}
writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const files = []
function inventory(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${path}`)
    if (entry.isDirectory()) inventory(path)
    else {
      const rel = relative(staging, path).replaceAll('\\', '/')
      assert(
        rel === 'manifest.json' ||
          rel.startsWith('node_modules/') ||
          sourceEntries.includes(`package/${rel}`),
        rel,
      )
      assert(!rel.endsWith('.node'), `Platform-specific native module: ${rel}`)
      files.push({ path: rel, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })
    }
  }
}
inventory(staging)
writeFileSync(
  join(release, 'mcpb-source-inventory.json'),
  JSON.stringify(
    {
      source,
      sourceLockSha256: createHash('sha256').update(readFileSync(lockSource)).digest('hex'),
      toolingVersion: toolPkg.version,
      sourceIntegrity: integrity,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      files,
    },
    null,
    2,
  ),
)
command(process.execPath, [cli, 'validate', join(staging, 'manifest.json')])
const output = join(release, `${pkg.name}-${pkg.version}.mcpb`)
const packing = command(process.execPath, [cli, 'pack', staging, output])
writeFileSync(join(release, 'mcpb-pack.log'), packing)
const bundleBytes = readFileSync(output)
console.log(
  JSON.stringify({
    artifact: output,
    bytes: bundleBytes.length,
    sha256: createHash('sha256').update(bundleBytes).digest('hex'),
    files: files.length,
    sourceIntegrity: integrity,
    node: manifest.compatibility.runtimes.node,
  }),
)
