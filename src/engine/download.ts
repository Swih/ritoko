import { existsSync } from 'node:fs'
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
export async function download(
  page: Page,
  trigger: Locator,
  dir: string,
  saveAs?: string,
  options: { clean?: boolean; timeout?: number } = {},
): Promise<string> {
  const { clean = false, timeout } = options
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
    const response = await page.request.get(href, { timeout: timeout ?? 60_000 })
    try {
      if (!response.ok()) throw new Error(`Download failed: HTTP ${response.status()} for ${href}`)
      const disposition = response
        .headers()
        ['content-disposition']?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1]
      const file = destination(
        dir,
        saveAs,
        decodeName(disposition ?? basename(new URL(href).pathname)),
        clean,
      )
      if (Number(response.headers()['content-length'] ?? 0) > MAX_BYTES) throw tooLarge()
      const body = await response.body()
      if (body.length > MAX_BYTES) throw tooLarge()
      await writeFile(file, body, { flag: 'wx' })
      return file
    } finally {
      await response.dispose()
    }
  }

  const waiting = anyTabDownload(page, timeout)
  try {
    const [event] = await Promise.all([waiting.promise, trigger.click(timeout ? { timeout } : {})])
    const file = destination(dir, saveAs, event.suggestedFilename(), clean)
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

// Characters Windows forbids in file names (C0 controls included).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const RESERVED = /[<>:"|?*\x00-\x1f]/g
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
const MAX_NAME = 120

/** A name safe on Windows, macOS and Linux: no directories, reserved characters or device names, bounded length. */
export function cleanName(name: string): string {
  const base = basename(win32.basename(name))
    .replace(RESERVED, '_')
    .replace(/[. ]+$/, '')
  const ext = extname(base).slice(0, 16)
  const cut = base.slice(0, base.length - ext.length).slice(0, MAX_NAME - ext.length)
  const safe = (cut + ext).replace(/[. ]+$/, '')
  return DEVICE.test(safe) ? `_${safe}` : safe
}

/**
 * Path for a file in `dir`. `saveAs` is the requested name (a literal must be a plain filename; a rendered
 * template, `clean`, is sanitized instead, since row data is untrusted). Without an extension of its own it
 * keeps the one of `suggested`, the real file name. Never overwrites: a taken name becomes "name (2).ext".
 */
export function destination(
  dir: string,
  saveAs: string | undefined,
  suggested: string,
  clean = false,
): string {
  if (
    saveAs &&
    !clean &&
    (saveAs !== basename(win32.basename(saveAs)) ||
      saveAs.replace(RESERVED, '_') !== saveAs ||
      /^[. ]+$/.test(saveAs))
  )
    throw new Error('saveAs must be a plain filename, without directories or reserved characters')
  const safe = cleanName(suggested)
  const requested = (clean && saveAs ? cleanName(saveAs) : saveAs) || safe || 'download'
  const name = extname(requested) ? requested : cleanName(requested + extname(safe))
  const ext = extname(name)
  for (let n = 1; ; n++) {
    const file = join(dir, n === 1 ? name : `${name.slice(0, name.length - ext.length)} (${n})${ext}`)
    if (!existsSync(file)) return file
  }
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
