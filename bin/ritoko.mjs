#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
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
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
  ]
  const npm = candidates.find(existsSync)
  if (!npm) throw new Error(`Run npm install --omit=dev --ignore-scripts in ${root}, then retry Ritoko.`)
  process.stderr.write('Ritoko: installing runtime dependencies once…\n')
  const result = spawnSync(
    process.execPath,
    [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  if (result.error || result.status !== 0)
    throw new Error(`Dependency installation failed: ${result.error?.message ?? result.stderr.toString()}`)
}
const source = join(root, 'src', 'cli.ts')
const entry = existsSync(source) ? source : join(root, 'dist', 'cli.mjs')
if (!existsSync(entry)) throw new Error('Ritoko entry point is missing. Reinstall the plugin.')
await import(pathToFileURL(entry).href)
