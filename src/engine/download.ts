import { randomUUID } from 'node:crypto'
import { rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, win32 } from 'node:path'
import type { Download, Locator, Page } from 'playwright-core'

const MAX_BYTES = 200 * 1024 * 1024
const tooLarge = () => new Error(`Download exceeds the ${MAX_BYTES / 1024 / 1024} MB limit`)

/** Percent-decoded file name; a malformed escape keeps the name as sent. */
function decodeName(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** Rejects when `promise` takes longer than `ms`: a page whose main thread is blocked never answers. */
export function bounded<T>(promise: Promise<T>, what: string, ms = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} got no answer within ${ms / 1000} s: the page may be frozen`)),
      ms,
    )
  })
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

/**
 * Downloads what `trigger` points to into `dir` and returns the saved path.
 * Plain links are fetched with the page's cookies: reliable even when they open a tab that closes at once
 * (target="_blank"). Anything else goes through the browser download event, caught on any tab.
 */
export async function download(page: Page, trigger: Locator, dir: string, saveAs?: string): Promise<string> {
  const href = await bounded(
    trigger.evaluate((el) => {
      const a = el.closest('a')
      if (!a?.href || !/^https?:/.test(a.href)) return null
      const target = new URL(a.href)
      return target.origin + target.pathname === location.origin + location.pathname ? null : a.href
    }),
    'Download link',
  )

  if (href) {
    const response = await page.request.get(href, { timeout: 60_000 })
    try {
      if (!response.ok()) throw new Error(`Download failed: HTTP ${response.status()} for ${href}`)
      const disposition = response
        .headers()
        ['content-disposition']?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1]
      const file = destination(dir, saveAs, decodeName(disposition ?? basename(new URL(href).pathname)))
      if (Number(response.headers()['content-length'] ?? 0) > MAX_BYTES) throw tooLarge()
      const body = await response.body()
      if (body.length > MAX_BYTES) throw tooLarge()
      await writeFile(file, body, { flag: 'wx' })
      return file
    } finally {
      await response.dispose()
    }
  }

  const waiting = anyTabDownload(page)
  try {
    const [event] = await Promise.all([waiting.promise, trigger.click()])
    const file = destination(dir, saveAs, event.suggestedFilename())
    await event.saveAs(file)
    if ((await stat(file)).size > MAX_BYTES) {
      await rm(file)
      throw tooLarge()
    }
    return file
  } finally {
    waiting.cancel()
  }
}

/** Keeps the real extension (e.g. .xlsx) when saveAs has none: input readers rely on it. */
// Characters Windows forbids in file names (C0 controls included).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const RESERVED = /[<>:"|?*\x00-\x1f]/g

export function destination(dir: string, saveAs: string | undefined, suggested: string): string {
  const safe = basename(win32.basename(suggested))
    .replace(RESERVED, '_')
    .replace(/[. ]+$/, '')
  if (
    saveAs &&
    (saveAs !== basename(win32.basename(saveAs)) ||
      saveAs.replace(RESERVED, '_') !== saveAs ||
      /^[. ]+$/.test(saveAs))
  )
    throw new Error('saveAs must be a plain filename, without directories or reserved characters')
  const requested = saveAs || safe || 'download'
  const name = extname(requested) ? requested : requested + extname(safe)
  // A unique prefix also avoids Windows device names and overwriting earlier evidence.
  return join(dir, `${randomUUID()}-${name}`)
}

function anyTabDownload(page: Page, timeout = 30_000): { promise: Promise<Download>; cancel: () => void } {
  const context = page.context()
  let cancel = () => {}
  const promise = new Promise<Download>((resolve, reject) => {
    const watched = new Set<Page>()
    const onPage = (p: Page) => {
      watched.add(p)
      p.once('download', done)
    }
    const timer = setTimeout(() => {
      cancel()
      reject(new Error('No download started'))
    }, timeout)
    cancel = () => {
      clearTimeout(timer)
      context.off('page', onPage)
      for (const p of watched) p.off('download', done)
    }
    function done(d: Download) {
      cancel()
      resolve(d)
    }
    for (const p of context.pages()) onPage(p)
    context.on('page', onPage)
  })
  return { promise, cancel: () => cancel() }
}
