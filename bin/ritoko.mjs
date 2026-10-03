#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Ritoko requires Node.js 24 or newer.')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(root, 'package.json'))
const dependencies = [
  'playwright-core',
  'zod',
  '@modelcontextprotocol/sdk/server/mcp.js',
  'read-excel-file/node',
]
let ready = true
for (const dependency of dependencies) {
  try {
    require.resolve(dependency)
  } catch {
    ready = false
  }
}
if (!ready) {
  // npm-cli.js next to node.exe (Windows), under the install prefix (nvm, fnm, volta, official tarballs),
  // under libexec (Homebrew), or wherever the npm on PATH links to; then distribution packages.
  const prefix = dirname(dirname(process.execPath))
  const cli = join('node_modules', 'npm', 'bin', 'npm-cli.js')
  const linked = (process.env.PATH ?? '')
    .split(delimiter)
    .map((dir) => join(dir, 'npm'))
    .filter(existsSync)
    .map((file) => realpathSync(file))
  const candidates = [
    join(dirname(process.execPath), cli),
    join(prefix, 'lib', cli),
    join(prefix, 'libexec', 'lib', cli),
    ...linked.filter((file) => file.endsWith('npm-cli.js')),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
  ]
  const npm = candidates.find(existsSync)
  if (!npm) throw new Error(`Run npm ci --omit=dev --ignore-scripts in ${root}, then retry Ritoko.`)
  process.stderr.write('Ritoko: installing runtime dependencies once…\n')
  const result = spawnSync(
    process.execPath,
    [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  if (result.error || result.status !== 0)
    throw new Error(`Dependency installation failed: ${result.error?.message ?? result.stderr.toString()}`)
}
// An npm install ships compiled JS in dist/ (Node cannot strip types under node_modules);
// a plugin clone runs the TypeScript sources directly.
const built = join(root, 'dist', 'cli.js')
const entry = existsSync(built) ? built : join(root, 'src', 'cli.ts')
if (!existsSync(entry)) throw new Error('Ritoko entry point is missing. Reinstall the plugin.')
await import(pathToFileURL(entry).href)
