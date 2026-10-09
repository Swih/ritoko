import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startService } from './service.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', '..', 'dist', 'cli.js')

async function command(args, home, log) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, RITOKO_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const timer = setTimeout(() => child.kill(), 30_000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    if (code !== 0) throw new Error(`ritoko ${args[0]} failed (${code}):\n${stdout}${stderr}`)
    if (log) log(stdout.trim())
    return stdout
  } finally {
    clearTimeout(timer)
  }
}

export async function runDemo({ log = console.log } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer.')
  try {
    await access(cli)
  } catch {
    throw new Error('Compiled CLI missing. In a repository checkout, run npm ci then npm run build.')
  }
  // Never use the user's existing journal.
  const home = await mkdtemp(join(tmpdir(), 'ritoko-first-run-'))
  const service = await startService()
  log('Ritoko first try — ten fake customers, local HTTP simulation.')
  log(`Journal and reports: ${home}`)
  log(`Service: ${service.url} (loopback only; stops when this command finishes)`)
  try {
    await command(['import', join(here, 'workflow.json')], home)
    const args = [
      'run',
      'first-run-customers',
      '--param',
      `input=${join(here, 'customers.csv')}`,
      '--param',
      `base=${service.url}`,
    ]
    log('\nFirst run: create each customer and verify it with a separate GET.')
    await command(args, home, log)
    const first = JSON.parse(await command(['report'], home))
    assert.deepEqual(first.counts, { done: 10 })
    assert.deepEqual(service.stats(), { writes: 10, unique: 10, reads: 10 })
    log('\nRerun: the same journal and destination skip the verified rows.')
    await command(args, home, log)
    const rerun = JSON.parse(await command(['report'], home))
    assert.deepEqual(rerun.counts, { skipped: 10 })
    assert.deepEqual(service.stats(), { writes: 10, unique: 10, reads: 10 })
    log('\nPASS: 10 verified customers; rerun skipped 10; 0 extra writes.')
    log('This is a localhost simulation, not evidence from a customer deployment.')
    return { home, first, rerun, stats: service.stats() }
  } finally {
    await service.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await runDemo()
  } catch (error) {
    console.error(`First try failed: ${error.message}`)
    process.exitCode = 1
  }
}
