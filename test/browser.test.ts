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
vi.mock('node:fs/promises', async () => ({
  ...(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')),
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
  mocks.readFile.mockRejectedValue(Object.assign(new Error('No DevToolsActivePort'), { code: 'ENOENT' }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (!root.startsWith(join(tmpdir(), 'ritoko-browser-test-'))) throw new Error('Unsafe cleanup path')
  rmSync(root, { recursive: true, force: true })
})

function child(stubborn = false, expectLease = true) {
  const process = Object.assign(new EventEmitter(), {
    pid: 123456,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    unref: vi.fn(),
    kill: vi.fn((signal: NodeJS.Signals) => {
      // Killing must happen while the launch lease still fences this startup.
      if (expectLease) {
        const ledger = new Ledger(join(root, 'ritoko.db'))
        try {
          expect(
            ledger.db.prepare("SELECT 1 FROM leases WHERE resource = 'browser-start'").get(),
          ).toBeDefined()
        } finally {
          ledger.db.close()
        }
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
  const send = vi.fn(async (_method: string) => ({ processInfo: [] as { type: string; id: number }[] }))
  const close = vi.fn(async () => {})
  mocks.readFile.mockResolvedValue('9222\n/devtools/browser/existing')
  const client = {
    contexts: () => [{}],
    isConnected: () => true,
    on: vi.fn(),
    newBrowserCDPSession: vi.fn(async () => ({ send })),
    close,
  }
  mocks.connect.mockResolvedValue(client)
  return { send, close, client }
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
    isConnected: () => true,
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

test('shutdown reconnects to MCP-owned Chrome after a transient CDP timeout without spawning', async () => {
  const existing = connection()
  mocks.connect.mockRejectedValueOnce(new Error('Timeout connecting after client disconnect'))
  await dedicated().shutdown()
  expect(mocks.connect).toHaveBeenCalledTimes(2)
  expect(mocks.connect.mock.calls[0]?.[1]).toMatchObject({ timeout: 5_000 })
  expect(existing.send).toHaveBeenCalledWith('Browser.close')
  expect(existing.close).toHaveBeenCalledOnce()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test.each(['Timeout connecting', 'ECONNREFUSED'])(
  'shutdown reports persistent %s instead of claiming Chrome closed',
  async (message) => {
    connection()
    mocks.connect.mockRejectedValue(new Error(message))
    await expect(dedicated().shutdown()).rejects.toThrow(/Could not close dedicated Chrome/)
    expect(mocks.time).toBe(110_000)
    expect(mocks.spawn).not.toHaveBeenCalled()
  },
)

test('shutdown does not mistake an unreadable endpoint for an absent browser', async () => {
  mocks.readFile.mockRejectedValue(Object.assign(new Error('Access denied'), { code: 'EACCES' }))
  await expect(dedicated().shutdown()).rejects.toThrow(/could not be read/)
  expect(mocks.time).toBe(110_000)
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('a connection with no context is disconnected and not published as a usable browser', async () => {
  const existing = connection()
  const invalid = { contexts: () => [], close: vi.fn(async () => {}) }
  mocks.connect.mockResolvedValueOnce(invalid)
  await dedicated().shutdown()
  expect(invalid.close).toHaveBeenCalledOnce()
  expect(mocks.connect).toHaveBeenCalledTimes(2)
  expect(existing.send).toHaveBeenCalledWith('Browser.close')
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('a late disconnect from an old connection cannot clear the replacement during shutdown', async () => {
  const existing = connection()
  const old = new EventEmitter()
  let oldConnected = true
  mocks.connect.mockResolvedValueOnce(
    Object.assign(old, {
      contexts: () => [
        {
          pages: () => [],
          newPage: async () => ({ bringToFront: async () => {} }),
          setDefaultTimeout: () => {},
          setDefaultNavigationTimeout: () => {},
          addInitScript: async () => {},
        },
      ],
      isConnected: () => oldConnected,
    }),
  )
  const browser = dedicated()
  await browser.page()
  oldConnected = false
  const send = existing.send
  mocks.connect.mockResolvedValue({
    contexts: () => [{}],
    isConnected: () => true,
    on: vi.fn(),
    close: existing.close,
    newBrowserCDPSession: async () => {
      old.emit('disconnected')
      return { send }
    },
  })
  await browser.shutdown()
  expect(send).toHaveBeenCalledWith('Browser.close')
  expect(existing.close).toHaveBeenCalledOnce()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('shutdown reports a still-living non-owned browser without sending any OS termination signal', async () => {
  const existing = connection()
  existing.send.mockResolvedValue({ processInfo: [{ type: 'browser', id: 345678 }] })
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
  await expect(dedicated().shutdown()).rejects.toThrow(/did not exit within 15 seconds/)
  expect(mocks.time).toBe(115_000)
  expect(kill.mock.calls.every(([pid, signal]) => pid === 345678 && signal === 0)).toBe(true)
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('shutdown reports an unconfirmed Browser.close error when no process identity is available', async () => {
  const existing = connection()
  existing.send.mockImplementation(async (method) => {
    if (method === 'Browser.close') throw new Error('CDP transport failed')
    return { processInfo: [] }
  })
  await expect(dedicated().shutdown()).rejects.toThrow(/Browser.close failed/)
  expect(existing.close).toHaveBeenCalledOnce()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test.each(['session', 'process-info', 'browser-close', 'disconnect'] as const)(
  'shutdown bounds a pending %s call without killing a non-owned Chrome',
  async (stage) => {
    const existing = connection()
    const pending = () => new Promise<never>(() => {})
    if (stage === 'session') existing.client.newBrowserCDPSession.mockImplementation(pending)
    if (stage === 'disconnect') existing.close.mockImplementation(pending)
    if (stage === 'process-info' || stage === 'browser-close')
      existing.send.mockImplementation(async (method) => {
        if (method === (stage === 'process-info' ? 'SystemInfo.getProcessInfo' : 'Browser.close'))
          return pending()
        return { processInfo: [] }
      })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const result = dedicated().shutdown()
    const checked =
      stage === 'process-info'
        ? expect(result).resolves.toBeUndefined()
        : expect(result).rejects.toThrow(
            stage === 'disconnect' ? /Could not disconnect/ : /Could not confirm/,
          )
    await vi.advanceTimersByTimeAsync(5_000)
    await checked
    if (stage === 'process-info') expect(existing.send).toHaveBeenCalledWith('Browser.close')
    expect(existing.close).toHaveBeenCalledOnce()
    expect(mocks.spawn).not.toHaveBeenCalled()
  },
)

test('pending CDP shutdown and disconnect still clean up the owned child in finally', async () => {
  const launched = child(false, false)
  const existing = connection()
  mocks.readFile.mockRejectedValueOnce(Object.assign(new Error('No endpoint yet'), { code: 'ENOENT' }))
  mocks.connect.mockResolvedValue({
    ...existing.client,
    contexts: () => [
      {
        pages: () => [],
        newPage: async () => ({ bringToFront: async () => {} }),
        setDefaultTimeout: () => {},
        setDefaultNavigationTimeout: () => {},
        addInitScript: async () => {},
      },
    ],
  })
  const browser = dedicated()
  await browser.page()
  existing.send.mockImplementation(async (method) =>
    method === 'Browser.close' ? new Promise<never>(() => {}) : { processInfo: [] },
  )
  existing.close.mockImplementation(() => new Promise<never>(() => {}))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const checked = expect(browser.shutdown()).rejects.toThrow(/Could not disconnect/)
  await vi.advanceTimersByTimeAsync(10_000)
  await checked
  expect(launched.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  expect(mocks.spawn).toHaveBeenCalledOnce()
})
