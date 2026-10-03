import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const pkg = json('package.json')
const server = json('server.json')
const lock = json('package-lock.json')
assert.equal(pkg.name, 'ritoko')
assert.equal(pkg.private, undefined, 'The npm package must be public')
assert.equal(pkg.mcpName, server.name, 'npm ownership proof must match the MCP namespace')
const repository = new URL(pkg.repository.url.replace(/^git\+/, ''))
assert.equal(repository.hostname, 'github.com', 'GitHub OIDC publishing requires a GitHub repository')
const [owner, repositoryName] = repository.pathname
  .slice(1)
  .replace(/\.git$/, '')
  .split('/')
assert.equal(
  server.name,
  `io.github.${owner}/${repositoryName}`,
  'MCP namespace must match the case-sensitive GitHub ownership granted by OIDC',
)
assert(server.description.length <= 100, 'MCP Registry descriptions are limited to 100 characters')
assert.equal(pkg.version, server.version, 'npm and MCP versions must match')
assert.equal(pkg.version, lock.version, 'npm lock version must match')
assert.equal(pkg.version, lock.packages[''].version, 'npm root lock version must match')
for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'kimi.plugin.json'])
  assert.equal(json(path).version, pkg.version, `${path}: version must match npm`)
assert.equal(server.packages.length, 1)
const entry = server.packages[0]
assert.equal(entry.registryType, 'npm')
assert.equal(entry.registryBaseUrl, 'https://registry.npmjs.org')
assert.equal(entry.identifier, pkg.name)
assert.equal(entry.version, pkg.version)
assert.equal(entry.transport.type, 'stdio')
assert.equal(entry.runtimeHint, 'npx')
assert.deepEqual(entry.packageArguments, [{ type: 'positional', value: 'mcp' }])
assert.equal(pkg.engines.node, '>=24')
assert(pkg.files.includes('dist'), 'Ship compiled JavaScript')
assert(!pkg.files.includes('src') && !pkg.files.includes('site'), 'Exclude source and website assets')
assert.equal(pkg.bin.ritoko, 'bin/ritoko.mjs')
for (const [name, version] of Object.entries(pkg.dependencies)) {
  assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version), `${name}: pin runtime dependencies`)
  assert.equal(lock.packages[`node_modules/${name}`].version, version, `${name}: lock must match`)
}
console.log(`Release metadata consistent: ${pkg.name}@${pkg.version}, ${server.name}`)
