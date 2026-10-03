import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { type BrowserContext, type Browser as Connection, chromium, type Page } from 'playwright-core'
import { Ledger } from './ledger.ts'
import { paths } from './paths.ts'

/**
 * One Chrome window with a dedicated, persistent profile: the agent records in it and the engine replays in it,
 * so logins done once by the user are reused by every run.
 */
export class Browser {
  readonly profile: string
  readonly headless: boolean
  readonly executablePath?: string
  #connection: Connection | undefined
  #context: BrowserContext | undefined
  #page: Page | undefined
  #opening: Promise<Page> | undefined

  constructor(options: { profile?: string; headless?: boolean; executablePath?: string } = {}) {
    this.profile = resolve(options.profile ?? paths.profile)
    // Owner-only: the profile holds the user's cookies, and Ritoko's home its journal.
    mkdirSync(this.profile, { recursive: true, mode: 0o700 })
    this.headless = options.headless ?? process.env.RITOKO_HEADLESS === '1'
    this.executablePath = options.executablePath ?? process.env.RITOKO_CHROME_PATH
  }

  async page(): Promise<Page> {
    if (this.#page && !this.#page.isClosed() && this.#connection?.isConnected()) return this.#page
    this.#opening ??= this.#open().finally(() => {
      this.#opening = undefined
    })
    return this.#opening
  }

  async #open(): Promise<Page> {
    const connecting = !this.#connection?.isConnected()
    let launched = false
    if (connecting) {
      const ledger = new Ledger(join(dirname(this.profile), 'ritoko.db'))
      try {
        await ledger.exclusive(async () => {
          if (await this.#attach()) return
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
          let launchError: Error | undefined
          child.on('error', (error) => {
            launchError = error
          })
          child.unref()
          launched = true
          const deadline = Date.now() + 20_000
          while (Date.now() < deadline) {
            if (launchError) throw launchError
            if (await this.#attach()) return
            await delay(100)
          }
          throw new Error(
            'Chrome did not expose its local CDP endpoint. Close the Ritoko Chrome window and retry.',
          )
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

  async #attach(): Promise<boolean> {
    try {
      const [port, route] = (await readFile(join(this.profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split(/\r?\n/)
      if (
        !port ||
        !/^\d+$/.test(port) ||
        Number(port) < 1 ||
        Number(port) > 65535 ||
        !route ||
        !/^\/devtools\/browser\/[\w-]+$/.test(route)
      )
        return false
      this.#connection = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${route}`, {
        timeout: 1_000,
        isLocal: true,
      })
      this.#context = this.#connection.contexts()[0]
      this.#connection.on('disconnected', () => {
        this.#connection = undefined
        this.#context = undefined
        this.#page = undefined
      })
      return Boolean(this.#context)
    } catch {
      return false
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

  /** Explicit shutdown, used by isolated tests and the browser-close command. */
  async shutdown(): Promise<void> {
    if (!this.#connection) await this.page()
    const session = await this.#connection?.newBrowserCDPSession()
    await session?.send('Browser.close').catch(() => {})
    await this.close().catch(() => {})
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
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Chrome executable not found: ${explicit}`)
    return explicit
  }
  const candidates =
    process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
          .filter((root): root is string => Boolean(root))
          .map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ]
  const found = candidates.find(existsSync)
  if (!found) throw new Error('Google Chrome is required. Install it or set RITOKO_CHROME_PATH.')
  return found
}
