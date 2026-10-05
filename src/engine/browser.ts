import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { type BrowserContext, type Browser as Connection, chromium, type Page } from 'playwright-core'
import { bounded } from './download.ts'
import { Ledger, processAlive } from './ledger.ts'
import { paths } from './paths.ts'

const NO_ENDPOINT = 'remote debugging was never enabled in this Chrome'

/** The user's everyday Chrome profile folder, where Chrome writes DevToolsActivePort once remote debugging is allowed. */
export function userChromeData(): string {
  if (process.env.RITOKO_CHROME_USER_DATA) return resolve(process.env.RITOKO_CHROME_USER_DATA)
  if (process.platform === 'win32')
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'Google',
      'Chrome',
      'User Data',
    )
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
  return join(homedir(), '.config', 'google-chrome')
}

/**
 * The browser the engine drives. By default it is the user's own Chrome, with its cookies and sessions, once
 * the user allowed remote debugging at chrome://inspect/#remote-debugging: Ritoko works in a tab of its own and
 * never closes Chrome or the user's tabs. A clean Chrome with a dedicated profile (no personal logins) is used
 * only when asked (RITOKO_BROWSER=clean), for headless runs and for an explicit profile: never as a silent
 * fallback.
 */
export class Browser {
  readonly profile: string
  readonly headless: boolean
  readonly executablePath?: string
  /** 'chrome' (the user's own Chrome) or 'dedicated' (a clean Chrome with Ritoko's own profile). */
  readonly mode: 'chrome' | 'dedicated'
  #connection: Connection | undefined
  #context: BrowserContext | undefined
  #page: Page | undefined
  #opening: Promise<Page> | undefined
  #shared = false
  /** Only the process this object actually spawned; never a PID discovered through CDP or a profile. */
  #child: ChildProcess | undefined
  #launchFailed = false

  constructor(options: { profile?: string; headless?: boolean; executablePath?: string } = {}) {
    this.profile = resolve(options.profile ?? paths.profile)
    // Owner-only: the profile holds the user's cookies, and Ritoko's home its journal.
    mkdirSync(this.profile, { recursive: true, mode: 0o700 })
    this.headless = options.headless ?? process.env.RITOKO_HEADLESS === '1'
    this.executablePath = options.executablePath ?? process.env.RITOKO_CHROME_PATH
    const mode = process.env.RITOKO_BROWSER ?? 'chrome'
    if (!['chrome', 'clean', 'dedicated'].includes(mode))
      throw new Error('RITOKO_BROWSER must be chrome or clean')
    // An explicit profile (tests, isolated homes) or a headless run never uses the user's Chrome.
    this.mode = options.profile || this.headless || mode !== 'chrome' ? 'dedicated' : 'chrome'
  }

  /** True when Ritoko drives the user's own Chrome rather than its dedicated one. */
  get shared(): boolean {
    return this.#shared
  }

  async page(): Promise<Page> {
    if (this.#page && !this.#page.isClosed() && this.#connection?.isConnected()) return this.#page
    this.#opening ??= this.#open().finally(() => {
      this.#opening = undefined
    })
    return this.#opening
  }

  async #open(): Promise<Page> {
    this.#launchFailed = false
    if (this.mode === 'chrome') {
      const why = await this.#openShared()
      if (why === true) return this.#page as Page
      throw new Error(
        `Ritoko could not connect to your Chrome (${why}). Open Chrome, enable chrome://inspect/#remote-debugging, and click Allow when Chrome asks. For a clean Chrome without your logins, ask for it (RITOKO_BROWSER=clean).`,
      )
    }
    const connecting = !this.#connection?.isConnected()
    let launched = false
    if (connecting) {
      const ledger = new Ledger(join(dirname(this.profile), 'ritoko.db'))
      try {
        await ledger.exclusive(async () => {
          if ((await this.#attach()) === true) return
          await mkdir(this.profile, { recursive: true, mode: 0o700 })
          await rm(join(this.profile, 'DevToolsActivePort'), { force: true })
          const child = spawn(
            chromePath(this.executablePath),
            [
              `--user-data-dir=${this.profile}`,
              '--remote-debugging-address=127.0.0.1',
              '--remote-debugging-port=0',
              '--no-first-run',
              '--no-default-browser-check',
              // "Continue where you left off": keeps session cookies (logins without "remember me").
              '--restore-last-session',
              ...(this.headless ? ['--headless=new'] : []),
              'about:blank',
            ],
            { stdio: 'ignore', detached: true, windowsHide: true },
          )
          this.#child = child
          child.once('exit', () => {
            if (this.#child === child) this.#child = undefined
          })
          let launchError: Error | undefined
          child.on('error', (error) => {
            launchError = error
          })
          child.unref()
          launched = true
          try {
            const deadline = Date.now() + 20_000
            while (Date.now() < deadline) {
              if (launchError) throw launchError
              if (child.exitCode !== null || child.signalCode !== null)
                throw new Error('Chrome exited before exposing its local CDP endpoint')
              if ((await this.#attach()) === true) return
              await delay(100)
            }
            throw new Error(
              'Chrome did not expose its local CDP endpoint. Close the Ritoko Chrome window and retry.',
            )
          } catch (error) {
            this.#launchFailed = true
            // Still under browser-start: another client cannot adopt this failed launch during cleanup.
            try {
              await this.#stopChild()
            } catch (cleanup) {
              throw new Error(`${(error as Error).message}; ${(cleanup as Error).message}`, { cause: error })
            }
            throw error
          }
        }, 'browser-start')
      } finally {
        ledger.db.close()
      }
    }
    if (!this.#context) throw new Error('Chrome has no browser context')
    this.#context.setDefaultTimeout(10_000)
    this.#context.setDefaultNavigationTimeout(30_000)
    if (connecting) await this.#context.addInitScript(sameTab)
    const pages = this.#context.pages()
    this.#page = pages.at(-1) ?? (await this.#context.newPage())
    // A new Chrome reopens the tabs of its previous session: keep a single working tab.
    if (launched) for (const other of pages) if (other !== this.#page) await other.close()
    // A background tab is throttled by Chrome: work in the visible one.
    await this.#page.bringToFront()
    return this.#page
  }

  /**
   * Attaches to the user's Chrome and returns Ritoko's own tab there: the one it used last time (its target id
   * is kept in Ritoko's home), else a new one. Chrome asks the user to allow each new connection.
   */
  async #openShared(): Promise<true | string> {
    if (!this.#connection?.isConnected()) {
      const attached = await this.#attach(userChromeData(), 60_000)
      if (attached !== true) return attached
    }
    this.#shared = true
    if (this.#page && !this.#page.isClosed()) return true
    const context = this.#context as BrowserContext
    const marker = join(dirname(this.profile), 'chrome-tab')
    const kept = await readFile(marker, 'utf8').catch(() => '')
    const id = async (page: Page) => {
      const session = await context.newCDPSession(page)
      try {
        return (await session.send('Target.getTargetInfo')).targetInfo.targetId
      } finally {
        await session.detach().catch(() => {})
      }
    }
    for (const page of context.pages())
      if (kept && (await id(page).catch(() => '')) === kept) this.#page = page
    if (!this.#page) {
      this.#page = await context.newPage()
      await writeFile(marker, await id(this.#page), { mode: 0o600 })
    }
    // Only Ritoko's tab gets the same-tab script: the user's own tabs behave as usual.
    await this.#page.addInitScript(sameTab)
    this.#page.setDefaultTimeout(10_000)
    this.#page.setDefaultNavigationTimeout(30_000)
    await this.#page.bringToFront()
    return true
  }

  /** Connects to the Chrome whose DevToolsActivePort is in `dir`: true, or the reason it could not. */
  async #attach(dir = this.profile, timeout = 1_000): Promise<true | string> {
    let file: string
    try {
      file = await readFile(join(dir, 'DevToolsActivePort'), 'utf8')
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? NO_ENDPOINT
        : 'its DevToolsActivePort file could not be read'
    }
    try {
      const [port, route] = file.trim().split(/\r?\n/)
      if (
        !port ||
        !/^\d+$/.test(port) ||
        Number(port) < 1 ||
        Number(port) > 65535 ||
        !route ||
        !/^\/devtools\/browser\/[\w-]+$/.test(route)
      )
        return 'its DevToolsActivePort file is invalid'
      const connection = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${route}`, {
        timeout,
        isLocal: true,
      })
      const context = connection.contexts()[0]
      if (!context) {
        await bounded(connection.close(), 'Disconnecting unusable Chrome', Math.min(timeout, 5_000)).catch(
          () => {},
        )
        return 'it exposes no browser context'
      }
      this.#connection = connection
      this.#context = context
      connection.on('disconnected', () => {
        // A late disconnect from an earlier client must not erase its replacement.
        if (this.#connection !== connection) return
        this.#connection = undefined
        this.#context = undefined
        this.#page = undefined
      })
      return true
    } catch (error) {
      const message = (error as Error).message
      return /ECONNREFUSED/.test(message)
        ? 'Chrome is not running, or remote debugging is off'
        : /Timeout/i.test(message)
          ? 'the connection was not allowed in time'
          : (message.split('\n')[0] ?? message)
    }
  }

  /** The working tab when this client is connected, without ever launching Chrome. */
  get current(): Page | undefined {
    return this.#connection?.isConnected() && !this.#page?.isClosed() ? this.#page : undefined
  }

  /** Disconnect this client; Chrome and its signed-in profile remain available to the other client. */
  async close(): Promise<void> {
    await this.#connection?.close()
  }

  /** Bounded cleanup of our own launch handle; never stop another Chrome by name, profile or discovered PID. */
  async #stopChild(): Promise<void> {
    const child = this.#child
    if (!child) return
    const exited = () => !child.pid || child.exitCode !== null || child.signalCode !== null
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      if (exited()) break
      child.kill(signal)
      const deadline = Date.now() + 2_000
      while (!exited() && Date.now() < deadline) await delay(50)
    }
    if (!exited()) throw new Error('The Chrome process launched by Ritoko did not exit during cleanup')
    if (this.#child === child) this.#child = undefined
  }

  /**
   * Explicit shutdown, used by isolated tests and the browser-close command. Returns once Chrome has exited:
   * a Chrome still closing (slower on macOS) would be reattached by the next client, or absorb a relaunch.
   */
  async shutdown(): Promise<void> {
    // The user's own Chrome is never closed: Ritoko only disconnects from it.
    if (this.#shared || this.mode === 'chrome') return bounded(this.close(), 'Disconnecting Chrome', 5_000)
    if (this.#launchFailed) return this.#stopChild()
    // Closing must never launch Chrome. An explicit dedicated browser-close may attach to an existing one.
    if (!this.#connection?.isConnected()) {
      const deadline = Date.now() + 10_000
      let attached: true | string = NO_ENDPOINT
      do {
        // Another client (e.g. the MCP process) may just have disconnected. Give its existing
        // Chrome time to answer CDP without ever launching a replacement.
        attached = await this.#attach(this.profile, Math.max(1, Math.min(5_000, deadline - Date.now())))
        if (attached === true || attached === NO_ENDPOINT) break
        if (Date.now() < deadline) await delay(Math.min(100, deadline - Date.now()))
      } while (Date.now() < deadline)
      if (attached !== true) {
        const owned = Boolean(this.#child)
        await this.#stopChild()
        if (!owned && attached !== NO_ENDPOINT)
          throw new Error(`Could not close dedicated Chrome: ${attached}`)
        return
      }
    }
    const connection = this.#connection
    if (!connection) throw new Error('Could not confirm dedicated Chrome shutdown: connection disappeared')
    const owned = Boolean(this.#child)
    let pid: number | undefined
    let closeError: unknown
    let disconnectError: unknown
    try {
      const session = await bounded(connection.newBrowserCDPSession(), 'Opening shutdown CDP session', 5_000)
      const info = await bounded(
        session.send('SystemInfo.getProcessInfo'),
        'Reading Chrome process info',
        5_000,
      ).catch(() => undefined)
      pid = info?.processInfo.find((p) => p.type === 'browser')?.id
      await bounded(session.send('Browser.close'), 'Closing Chrome', 5_000)
    } catch (error) {
      closeError = error
    } finally {
      try {
        await bounded(connection.close(), 'Disconnecting shutdown CDP client', 5_000).catch((error) => {
          disconnectError = error
        })
        const deadline = Date.now() + 15_000
        while (pid && processAlive(pid) && Date.now() < deadline) await delay(100)
      } finally {
        // Even a connected but frozen CDP endpoint must not strand our owned launch.
        await this.#stopChild()
      }
    }
    if (pid && processAlive(pid))
      throw new Error('Dedicated Chrome did not exit within 15 seconds of shutdown')
    if (!pid && closeError && !owned)
      throw new Error('Could not confirm dedicated Chrome shutdown: Browser.close failed', {
        cause: closeError,
      })
    if (disconnectError)
      throw new Error('Could not disconnect the shutdown CDP client', { cause: disconnectError })
  }
}

/**
 * Runs in every page Ritoko drives: a plain click on a target=_blank link, or a form submitted to _blank,
 * stays in the working tab. A new tab appears only after the click returns, so it cannot be followed
 * deterministically; the same navigation in the working tab can, and opens no stray tab.
 */
function sameTab() {
  const stay = (element: Element | null | undefined) => {
    if (element?.getAttribute('target') === '_blank') element.setAttribute('target', '_self')
  }
  document.addEventListener(
    'click',
    (event) => {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.target instanceof Element)
        stay(event.target.closest('a, area'))
    },
    true,
  )
  document.addEventListener('submit', (event) => stay(event.target as HTMLFormElement), true)
}

function chromePath(explicit?: string): string {
  const found = findChrome(explicit)
  if (found) return found
  throw new Error(
    explicit
      ? `Chrome executable not found: ${explicit}`
      : 'Google Chrome is required. Install it or set RITOKO_CHROME_PATH.',
  )
}

/** The Chrome executable a dedicated Chrome is launched from: the explicit one, else a standard install. */
export function findChrome(explicit?: string): string | undefined {
  if (explicit) return existsSync(explicit) ? explicit : undefined
  const candidates =
    process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
          .filter((root): root is string => Boolean(root))
          .map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : process.platform === 'darwin'
        ? ['/Applications', join(homedir(), 'Applications')].map((dir) =>
            join(dir, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
          )
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ]
  return candidates.find(existsSync)
}
