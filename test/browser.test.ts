import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  connect: vi.fn(),
  readFile: vi.fn(),
  time: 100_000,
  profile: '',
}))
vi.mock('../src/engine/paths.ts', () => ({
  paths: {
    get profile() {
      return mocks.profile
    },
  },
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('playwright-core', () => ({ chromium: { connectOverCDP: mocks.connect } }))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  readFile: mocks.readFile,
}))
vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    mocks.time += ms
  },
}))

import { Browser } from '../src/engine/browser.ts'
import { Ledger } from '../src/engine/ledger.ts'

let root: string
beforeEach(() => {
  vi.resetAllMocks()
  mocks.time = 100_000
  vi.spyOn(Date, 'now').mockImplementation(() => mocks.time)
  vi.stubEnv('RITOKO_BROWSER', 'chrome')
  vi.stubEnv('RITOKO_HEADLESS', '0')
  root = mkdtempSync(join(tmpdir(), 'ritoko-browser-test-'))
  mocks.profile = join(root, 'shared-profile')
  mocks.readFile.mockRejectedValue(new Error('No DevToolsActivePort'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (!root.startsWith(join(tmpdir(), 'ritoko-browser-test-'))) throw new Error('Unsafe cleanup path')
  rmSync(root, { recursive: true, force: true })
})

function child(stubborn = false) {
  const process = Object.assign(new EventEmitter(), {
    pid: 123456,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    unref: vi.fn(),
    kill: vi.fn((signal: NodeJS.Signals) => {
      // Killing must happen while the launch lease still fences this startup.
      const ledger = new Ledger(join(root, 'ritoko.db'))
      try {
        expect(ledger.db.prepare("SELECT 1 FROM leases WHERE resource = 'browser-start'").get()).toBeDefined()
      } finally {
        ledger.db.close()
      }
      if (!stubborn || signal === 'SIGKILL') {
        process.signalCode = signal
        process.emit('exit', null, signal)
      }
      return true
    }),
  })
  mocks.spawn.mockReturnValue(process as unknown as ChildProcess)
  return process
}

function dedicated() {
  return new Browser({ profile: join(root, 'profile'), headless: true, executablePath: process.execPath })
}

test('an unattached launch is stopped under its lease; shutdown never respawns', async () => {
  const launched = child()
  const browser = dedicated()
  await expect(browser.page()).rejects.toThrow(/did not expose/)
  expect(launched.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  await browser.shutdown()
  await browser.shutdown()
  expect(mocks.spawn).toHaveBeenCalledTimes(1)
  expect(launched.kill).toHaveBeenCalledTimes(1)
})

test('failed attachment escalates only the owned child handle and bounds the wait', async () => {
  const launched = child(true)
  mocks.readFile.mockResolvedValue('9222\n/devtools/browser/fixture')
  mocks.connect.mockRejectedValue(new Error('Timeout connecting'))
  const browser = dedicated()
  await expect(browser.page()).rejects.toThrow(/did not expose/)
  expect(launched.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
  expect(mocks.time).toBeLessThanOrEqual(124_000)
  const connections = mocks.connect.mock.calls.length
  await browser.shutdown()
  expect(mocks.spawn).toHaveBeenCalledTimes(1)
  expect(mocks.connect).toHaveBeenCalledTimes(connections)
})

test('a process that already exited is never killed or restarted by shutdown', async () => {
  const launched = child()
  launched.exitCode = 7
  const browser = dedicated()
  await expect(browser.page()).rejects.toThrow(/exited before/)
  await browser.shutdown()
  expect(launched.kill).not.toHaveBeenCalled()
  expect(mocks.spawn).toHaveBeenCalledTimes(1)
})

test('shutdown with no dedicated endpoint does not launch Chrome', async () => {
  await dedicated().shutdown()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

function connection() {
  const send = vi.fn(async () => ({ processInfo: [] }))
  const close = vi.fn(async () => {})
  mocks.readFile.mockResolvedValue('9222\n/devtools/browser/existing')
  mocks.connect.mockResolvedValue({
    contexts: () => [{}],
    on: vi.fn(),
    newBrowserCDPSession: async () => ({ send }),
    close,
  })
  return { send, close }
}

test('explicit shutdown still closes a preexisting dedicated browser through CDP without spawning or killing', async () => {
  const existing = connection()
  await dedicated().shutdown()
  expect(existing.send).toHaveBeenCalledWith('Browser.close')
  expect(existing.close).toHaveBeenCalledOnce()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('shared Chrome shutdown never connects, spawns or sends Browser.close', async () => {
  const existing = connection()
  const browser = new Browser()
  expect(browser.mode).toBe('chrome')
  await browser.shutdown()
  expect(mocks.spawn).not.toHaveBeenCalled()
  expect(mocks.connect).not.toHaveBeenCalled()
  expect(existing.send).not.toHaveBeenCalled()
})

test('an attached shared Chrome is only disconnected, never closed or fallback-killed', async () => {
  const existing = connection()
  const page = {
    addInitScript: vi.fn(),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    bringToFront: vi.fn(),
  }
  mocks.connect.mockResolvedValue({
    contexts: () => [
      {
        pages: () => [],
        newPage: async () => page,
        newCDPSession: async () => ({
          send: async () => ({ targetInfo: { targetId: 'ritoko-tab' } }),
          detach: async () => {},
        }),
      },
    ],
    on: vi.fn(),
    close: existing.close,
    newBrowserCDPSession: async () => ({ send: existing.send }),
  })
  const browser = new Browser()
  await browser.page()
  expect(browser.shared).toBe(true)
  await browser.shutdown()
  expect(existing.close).toHaveBeenCalledOnce()
  expect(existing.send).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})
