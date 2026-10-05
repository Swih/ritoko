import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findChrome } from '../src/engine/browser.ts'
import { type Check, diagnose, format, type Machine } from '../src/engine/doctor.ts'
import { Ledger } from '../src/engine/ledger.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'ritoko-test-'))) throw new Error('Unsafe test cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})

const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'ritoko-test-'))
  roots.push(root)
  return root
}

/** A machine where everything works, around a home that does not exist yet: each test breaks one thing. */
function machine(patch: Partial<Machine> = {}): Partial<Machine> {
  const home = join(temporary(), 'home')
  return {
    node: '24.0.0',
    env: {},
    home,
    db: join(home, 'ritoko.db'),
    sqlite: () => import('node:sqlite'),
    playwright: async () => ({}),
    chrome: async (explicit) => (explicit ? undefined : '/opt/google/chrome/chrome'),
    alive: () => true,
    now: Date.now,
    ...patch,
  }
}

const statuses = (checks: Check[]) => Object.fromEntries(checks.map((c) => [c.name, c.status]))
const check = (checks: Check[], name: string) => checks.find((c) => c.name === name)

describe('doctor', () => {
  it('passes a working installation and creates nothing: no home, no journal', async () => {
    const m = machine()
    const checks = await diagnose(m)
    expect(statuses(checks)).toEqual({
      node: 'pass',
      sqlite: 'pass',
      home: 'pass',
      journal: 'pass',
      playwright: 'pass',
      browser: 'pass',
      chrome: 'pass',
    })
    expect(check(checks, 'home')?.detail).toContain('does not exist yet')
    expect(check(checks, 'journal')?.detail).toContain('No journal yet')
    expect(checks.every((c) => c.fix === undefined)).toBe(true)
    expect(existsSync(m.home as string)).toBe(false)
  })

  it('requires the Node.js major version of package.json engines', async () => {
    const engines = JSON.parse(readFileSync('package.json', 'utf8')).engines.node
    expect(engines).toBe('>=24')
    expect(check(await diagnose(machine({ node: '24.0.0' })), 'node')?.status).toBe('pass')
    expect(check(await diagnose(machine({ node: '23.11.1' })), 'node')).toMatchObject({
      status: 'fail',
      detail: 'Node.js 23.11.1: Ritoko requires 24 or newer',
      fix: 'Install Node.js 24 or newer and run Ritoko with it.',
    })
  })

  it('fails without node:sqlite or playwright-core, each with a fix', async () => {
    const checks = await diagnose(
      machine({
        sqlite: () => Promise.reject(new Error('No such built-in module: node:sqlite')),
        playwright: () => Promise.reject(new Error("Cannot find package 'playwright-core'")),
      }),
    )
    expect(statuses(checks)).toMatchObject({ sqlite: 'fail', journal: 'warn', playwright: 'fail' })
    expect(check(checks, 'sqlite')?.detail).toBe(
      'node:sqlite does not load: No such built-in module: node:sqlite',
    )
    expect(checks.filter((c) => c.status !== 'pass').every((c) => c.fix)).toBe(true)
    // The Chrome finder lives in the browser module, which needs both.
    const lookup = await diagnose(
      machine({ chrome: () => Promise.reject(new Error("Cannot find package 'playwright-core'")) }),
    )
    expect(check(lookup, 'chrome')).toMatchObject({
      status: 'warn',
      detail: "Chrome lookup failed: Cannot find package 'playwright-core'",
      fix: 'Fix the failed checks above first.',
    })
  })

  it('checks the journal read-only and lists stale leases', async () => {
    const m = machine({ home: temporary() })
    const db = join(m.home as string, 'ritoko.db')
    const ledger = new Ledger(db)
    const lease = ledger.db.prepare(
      'INSERT INTO leases (resource, owner, pid, heartbeat) VALUES (?, ?, ?, ?)',
    )
    lease.run('execution', 'dead', 4242, Date.now())
    lease.run('browser-start', 'hung', 4343, Date.now() - 120_000)
    lease.run('other', 'busy', 4444, Date.now())
    ledger.db.close()
    const before = readFileSync(db)
    const checks = await diagnose({ ...m, db, alive: (pid) => pid !== 4242 })
    expect(check(checks, 'journal')).toEqual({
      name: 'journal',
      status: 'pass',
      detail: `${db}: integrity ok`,
    })
    expect(check(checks, 'leases')).toMatchObject({
      status: 'warn',
      detail:
        'Stale: browser-start (process 4343), execution (process 4242), whose process exited or stopped responding; in use: other (process 4444)',
    })
    expect(readFileSync(db)).toEqual(before)

    writeFileSync(db, 'not a database, just text that looks nothing like SQLite')
    expect(check(await diagnose({ ...m, db }), 'journal')).toMatchObject({
      status: 'fail',
      fix: expect.stringContaining('keep a copy of ritoko.db'),
    })
  })

  it('reports a home that is a file or cannot be created', async () => {
    const file = join(temporary(), 'file')
    writeFileSync(file, '')
    expect(check(await diagnose(machine({ home: file })), 'home')).toMatchObject({
      status: 'fail',
      detail: `${file} is not a folder`,
    })
    expect(check(await diagnose(machine({ home: join(file, 'home') })), 'home')).toMatchObject({
      status: 'fail',
      fix: expect.stringContaining('RITOKO_HOME'),
    })
    const existing = temporary()
    expect(check(await diagnose(machine({ home: existing })), 'home')).toEqual({
      name: 'home',
      status: 'pass',
      detail: `${existing} is writable`,
    })
  })

  it('validates RITOKO_BROWSER and needs a Chrome executable only for a separate Chrome', async () => {
    const env = (vars: Record<string, string>, chrome?: Machine['chrome']) =>
      diagnose(machine({ env: vars, ...(chrome && { chrome }) }))
    expect(check(await env({ RITOKO_BROWSER: 'firefox' }), 'browser')).toMatchObject({
      status: 'fail',
      detail: 'RITOKO_BROWSER=firefox is not valid',
    })
    const none = async () => undefined
    expect(check(await env({}, none), 'chrome')?.status).toBe('warn')
    expect(check(await env({ RITOKO_HEADLESS: '1' }, none), 'chrome')?.status).toBe('fail')
    expect(check(await env({ RITOKO_BROWSER: 'clean' }, none), 'chrome')?.status).toBe('fail')
    expect(
      check(await env({ RITOKO_BROWSER: 'clean', RITOKO_CHROME_PATH: '/nowhere/chrome' }), 'chrome'),
    ).toMatchObject({ status: 'fail', detail: 'RITOKO_CHROME_PATH=/nowhere/chrome does not exist' })
    expect(check(await env({ RITOKO_BROWSER: 'clean' }), 'browser')).toMatchObject({
      status: 'pass',
      detail: "A separate Chrome with Ritoko's own profile (RITOKO_BROWSER=clean)",
    })
    // The real finder never throws: an explicit path is returned only when it exists.
    const executable = join(temporary(), 'chrome')
    writeFileSync(executable, '')
    expect(findChrome(executable)).toBe(executable)
    expect(findChrome(`${executable}-missing`)).toBeUndefined()
  })

  it('prints one line per check with its fix below, then the totals', () => {
    expect(
      format([
        { name: 'node', status: 'pass', detail: 'Node.js 24.0.0' },
        { name: 'chrome', status: 'warn', detail: 'No Chrome executable', fix: 'Install Google Chrome.' },
        { name: 'browser', status: 'fail', detail: 'RITOKO_BROWSER=x is not valid', fix: 'Unset it.' },
      ]),
    ).toBe(
      [
        'pass  node     Node.js 24.0.0',
        'warn  chrome   No Chrome executable',
        '               fix: Install Google Chrome.',
        'fail  browser  RITOKO_BROWSER=x is not valid',
        '               fix: Unset it.',
        '1 pass, 1 warn, 1 fail',
      ].join('\n'),
    )
  })

  it('exits with 1 on a failed check from the command line, without creating the home', async () => {
    const home = join(temporary(), 'home')
    const env: NodeJS.ProcessEnv = { ...process.env, RITOKO_HOME: home, RITOKO_BROWSER: 'firefox' }
    delete env.RITOKO_HEADLESS
    delete env.RITOKO_CHROME_PATH
    const child = spawn(process.execPath, ['src/cli.ts', 'doctor', '--json'], { env, windowsHide: true })
    let stdout = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    const code = await new Promise((done) => child.once('close', done))
    expect(code).toBe(1)
    const result = JSON.parse(stdout)
    expect(result.ok).toBe(false)
    expect(check(result.checks, 'browser')?.status).toBe('fail')
    expect(existsSync(home)).toBe(false)
  })
})
