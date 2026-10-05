import { constants } from 'node:fs'
import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { home, paths } from './paths.ts'

export type Check = { name: string; status: 'pass' | 'warn' | 'fail'; detail: string; fix?: string }

/**
 * What the checks look at, replaceable in tests. node:sqlite, playwright-core and the modules needing them load
 * inside the checks, so that a broken installation gets a diagnosis rather than a crash.
 */
export type Machine = {
  node: string
  env: Record<string, string | undefined>
  home: string
  db: string
  sqlite: () => Promise<typeof import('node:sqlite')>
  playwright: () => Promise<unknown>
  chrome: (explicit?: string) => Promise<string | undefined>
  /** Default: the journal's own test of a lease holder. */
  alive?: (pid: number) => boolean
  now: () => number
}

/** As package.json "engines" (>=24) and bin/ritoko.mjs: the major version decides. */
const NODE_MAJOR = 24
/** Values the Browser accepts for RITOKO_BROWSER. */
const MODES = ['chrome', 'clean', 'dedicated']
const JOURNAL_FIX =
  'Stop Ritoko and keep a copy of ritoko.db before any repair (e.g. sqlite3 .recover): it is the record that prevents submitting rows twice.'

const machine = (): Machine => ({
  node: process.versions.node,
  env: process.env,
  home,
  db: paths.db,
  sqlite: () => import('node:sqlite'),
  playwright: () => import('playwright-core'),
  chrome: async (explicit) => (await import('./browser.ts')).findChrome(explicit),
  now: Date.now,
})

const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split('\n')[0] ?? ''

/** Checks the installation. It starts no browser and opens the journal read-only. */
export async function diagnose(overrides: Partial<Machine> = {}): Promise<Check[]> {
  const m: Machine = { ...machine(), ...overrides }
  const checks: Check[] = []
  const pass = (name: string, detail: string) => checks.push({ name, status: 'pass', detail })
  const problem = (name: string, status: 'warn' | 'fail', detail: string, fix: string) =>
    checks.push({ name, status, detail, fix })

  if (Number(m.node.split('.')[0]) >= NODE_MAJOR) pass('node', `Node.js ${m.node}`)
  else
    problem(
      'node',
      'fail',
      `Node.js ${m.node}: Ritoko requires ${NODE_MAJOR} or newer`,
      `Install Node.js ${NODE_MAJOR} or newer and run Ritoko with it.`,
    )

  const sqlite = await m.sqlite().catch((error) => {
    problem(
      'sqlite',
      'fail',
      `node:sqlite does not load: ${firstLine(error)}`,
      `Use an official Node.js ${NODE_MAJOR}+ build: node:sqlite is part of it.`,
    )
    return undefined
  })
  if (sqlite) pass('sqlite', 'node:sqlite loads')

  checks.push(await homeCheck(m.home))

  if (sqlite) checks.push(...(await journal(sqlite, m)))
  else problem('journal', 'warn', 'Not checked: node:sqlite does not load', 'Fix node:sqlite first.')

  await m.playwright().then(
    () => pass('playwright', 'playwright-core loads'),
    (error) =>
      problem(
        'playwright',
        'fail',
        `playwright-core does not load: ${firstLine(error)}`,
        "Run npm ci --omit=dev --ignore-scripts in Ritoko's folder, or reinstall Ritoko.",
      ),
  )

  const mode = m.env.RITOKO_BROWSER
  const headless = m.env.RITOKO_HEADLESS === '1'
  // Like Browser: headless runs and RITOKO_BROWSER=clean launch a separate Chrome from its executable.
  const dedicated = headless || mode === 'clean' || mode === 'dedicated'
  if (mode !== undefined && !MODES.includes(mode))
    problem(
      'browser',
      'fail',
      `RITOKO_BROWSER=${mode} is not valid`,
      'Set RITOKO_BROWSER to chrome or clean, or unset it.',
    )
  else
    pass(
      'browser',
      dedicated
        ? `A separate Chrome with Ritoko's own profile (${headless ? 'RITOKO_HEADLESS=1' : `RITOKO_BROWSER=${mode}`})`
        : 'Your own Chrome (default): Ritoko connects once remote debugging is allowed at chrome://inspect/#remote-debugging',
    )

  const explicit = m.env.RITOKO_CHROME_PATH
  const found = await m.chrome(explicit).catch((error) => new Error(firstLine(error)))
  const severity = dedicated ? 'fail' : 'warn'
  if (found instanceof Error)
    problem(
      'chrome',
      severity,
      `Chrome lookup failed: ${found.message}`,
      'Fix the failed checks above first.',
    )
  else if (found) pass('chrome', `Chrome executable: ${found}`)
  else if (explicit)
    problem(
      'chrome',
      severity,
      `RITOKO_CHROME_PATH=${explicit} does not exist`,
      'Point RITOKO_CHROME_PATH to the Chrome executable, or unset it.',
    )
  else
    problem(
      'chrome',
      severity,
      'No Chrome executable in the standard locations',
      'Install Google Chrome or set RITOKO_CHROME_PATH: a separate Chrome (RITOKO_BROWSER=clean, headless runs) is launched from it.',
    )
  return checks
}

/** Ritoko's home must accept files; until the first use creates it, its nearest existing parent must. */
async function homeCheck(dir: string): Promise<Check> {
  const fix = 'Set RITOKO_HOME to a folder you can write to, or fix the permissions of this one.'
  const info = await stat(dir).catch(() => undefined)
  if (info && !info.isDirectory())
    return { name: 'home', status: 'fail', detail: `${dir} is not a folder`, fix }
  if (!info) {
    let parent = dirname(dir)
    while (!(await stat(parent).catch(() => undefined)) && dirname(parent) !== parent)
      parent = dirname(parent)
    try {
      if (!(await stat(parent)).isDirectory()) throw new Error(`${parent} is not a folder`)
      await access(parent, constants.W_OK)
      return { name: 'home', status: 'pass', detail: `${dir} does not exist yet: the first use creates it` }
    } catch (error) {
      return { name: 'home', status: 'fail', detail: `${dir} cannot be created: ${firstLine(error)}`, fix }
    }
  }
  // A real write: access() does not see Windows permissions.
  try {
    await rm(await mkdtemp(join(dir, '.doctor-')), { recursive: true })
    return { name: 'home', status: 'pass', detail: `${dir} is writable` }
  } catch (error) {
    return { name: 'home', status: 'fail', detail: `${dir} is not writable: ${firstLine(error)}`, fix }
  }
}

/** Integrity of the journal and the state of its leases, read-only: a missing journal is not created. */
async function journal(sqlite: typeof import('node:sqlite'), m: Machine): Promise<Check[]> {
  if (!(await stat(m.db).catch(() => undefined)))
    return [
      { name: 'journal', status: 'pass', detail: `No journal yet at ${m.db}: the first run creates it` },
    ]
  let db: InstanceType<typeof sqlite.DatabaseSync> | undefined
  try {
    db = new sqlite.DatabaseSync(m.db, { readOnly: true, timeout: 5_000 })
    const problems = db
      .prepare('PRAGMA integrity_check')
      .all()
      .map((row) => String(Object.values(row)[0]))
      .filter((line) => line !== 'ok')
    if (problems.length)
      return [
        {
          name: 'journal',
          status: 'fail',
          detail: `${m.db}: ${problems.slice(0, 3).join('; ')}`,
          fix: JOURNAL_FIX,
        },
      ]
    const checks: Check[] = [{ name: 'journal', status: 'pass', detail: `${m.db}: integrity ok` }]
    const leases = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'leases'").get()
      ? db.prepare('SELECT * FROM leases ORDER BY resource').all()
      : []
    // Loaded now that node:sqlite is known to work.
    const { LEASE_EXPIRY_MS, processAlive } = await import('./ledger.ts')
    const alive = m.alive ?? processAlive
    const describe = (lease: Record<string, unknown>) => `${lease.resource} (process ${lease.pid})`
    const stale = leases.filter(
      (lease) => !(alive(Number(lease.pid)) && m.now() - Number(lease.heartbeat ?? 0) < LEASE_EXPIRY_MS),
    )
    const held = leases.filter((lease) => !stale.includes(lease)).map(describe)
    if (stale.length)
      checks.push({
        name: 'leases',
        status: 'warn',
        detail: `Stale: ${stale.map(describe).join(', ')}, whose process exited or stopped responding${held.length ? `; in use: ${held.join(', ')}` : ''}`,
        fix: 'The next operation takes it over. A run it was executing is interrupted: find it with run_list and resume it.',
      })
    else
      checks.push({
        name: 'leases',
        status: 'pass',
        detail: held.length ? `In use by a running operation: ${held.join(', ')}` : 'None held',
      })
    return checks
  } catch (error) {
    return [
      {
        name: 'journal',
        status: 'fail',
        detail: `${m.db} cannot be read: ${firstLine(error)}`,
        fix: JOURNAL_FIX,
      },
    ]
  } finally {
    db?.close()
  }
}

/** Plain text: one line per check, its fix below it, then the totals. */
export function format(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.name.length))
  const count = (status: Check['status']) => checks.filter((c) => c.status === status).length
  return [
    ...checks.flatMap((c) => [
      `${c.status.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`,
      ...(c.fix ? [`${' '.repeat(width + 8)}fix: ${c.fix}`] : []),
    ]),
    `${count('pass')} pass, ${count('warn')} warn, ${count('fail')} fail`,
  ].join('\n')
}
