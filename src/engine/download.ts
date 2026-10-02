import { writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Download, Locator, Page } from 'playwright-core'

/**
 * Downloads what `trigger` points to into `dir` and returns the saved path.
 * Plain links are fetched with the page's cookies: reliable even when they open a tab that closes at once
 * (target="_blank"). Anything else goes through the browser download event, caught on any tab.
 */
export async function download(page: Page, trigger: Locator, dir: string, saveAs?: string): Promise<string> {
  const href = await trigger.evaluate((el) => {
    const a = el.closest('a')
    if (!a?.href || !/^https?:/.test(a.href)) return null
    const target = new URL(a.href)
    return target.origin + target.pathname === location.origin + location.pathname ? null : a.href
  })

  if (href) {
    const response = await page.request.get(href)
    if (!response.ok()) throw new Error(`Download failed: HTTP ${response.status()} for ${href}`)
    const disposition = response
      .headers()
      ['content-disposition']?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1]
    const file = join(dir, name(saveAs, decodeURIComponent(disposition ?? basename(new URL(href).pathname))))
    await writeFile(file, await response.body())
    return file
  }

  const [event] = await Promise.all([anyTabDownload(page), trigger.click()])
  const file = join(dir, name(saveAs, event.suggestedFilename()))
  await event.saveAs(file)
  return file
}

/** Keeps the real extension (e.g. .xlsx) when saveAs has none: input readers rely on it. */
function name(saveAs: string | undefined, suggested: string): string {
  if (!saveAs) return suggested
  return extname(saveAs) ? saveAs : saveAs + extname(suggested)
}

function anyTabDownload(page: Page, timeout = 30_000): Promise<Download> {
  const context = page.context()
  return new Promise((resolve, reject) => {
    const onPage = (p: Page) => p.once('download', done)
    const timer = setTimeout(() => finish(() => reject(new Error('No download started'))), timeout)
    function finish(settle: () => void) {
      clearTimeout(timer)
      context.off('page', onPage)
      page.off('download', done)
      settle()
    }
    function done(d: Download) {
      finish(() => resolve(d))
    }
    page.once('download', done)
    context.on('page', onPage)
  })
}
