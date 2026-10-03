import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'dist')
// Check the absolute target before deleting generated output, including on Windows.
if (dirname(output) !== root || basename(output) !== 'dist') throw new Error('Invalid build output path')
rmSync(output, { recursive: true, force: true })
const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.build.json')],
  { cwd: root, stdio: 'inherit', windowsHide: true },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
