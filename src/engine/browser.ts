import { type BrowserContext, chromium, type Page } from 'playwright-core'
import { paths } from './paths.ts'

/**
 * One Chrome window with a dedicated, persistent profile: the agent records in it and the engine replays in it,
 * so logins done once by the user are reused by every run.
 */
export class Browser {
  #context: BrowserContext | undefined

  async page(): Promise<Page> {
    if (!this.#context) {
      this.#context = await chromium.launchPersistentContext(paths.profile, {
        channel: process.env.RITOKO_BROWSER ?? 'chrome',
        headless: process.env.RITOKO_HEADLESS === '1',
        viewport: null,
        acceptDownloads: true,
      })
      this.#context.on('close', () => {
        this.#context = undefined
      })
    }
    const pages = this.#context.pages()
    return pages.at(-1) ?? (await this.#context.newPage())
  }

  async close(): Promise<void> {
    await this.#context?.close()
    this.#context = undefined
  }
}
