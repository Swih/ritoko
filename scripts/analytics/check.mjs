// Focused browser checks; fake collector, no production analytics pollution.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { contentRoutes } from '../../site/content-routes.js'

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((path) => path && existsSync(path))
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome executable.')
const browser = await chromium.launch({ executablePath, headless: true })
const id = '11111111-1111-4111-8111-111111111111'
const fixture = `<html><head></head><body>
<section id="install"><div role="tabpanel" id="install-claude"><button data-copy>Copy</button></div></section>
<a href="https://github.com/Swih/ritoko?token=secret">GitHub</a>
<div class="footer-bottom"></div><script type="module" src="/analytics.js"></script></body></html>`
const mockTracker = `window.umami = { track(name, data) {
const payload = window.ritokoAnalyticsBeforeSend('event', {name, data, url: location.href, title: 'secret'});
if (payload) return fetch('https://stats.test/api/send', {method:'POST', body:JSON.stringify(payload)});
} };`

async function session({
  enabled = true,
  host = 'ritoko.com',
  dnt = false,
  gpc = false,
  broken = false,
  path = '/',
} = {}) {
  const context = await browser.newContext()
  const events = []
  let loads = 0
  await context.addInitScript(
    ({ dnt, gpc }) => {
      Object.defineProperty(navigator, 'doNotTrack', { value: dnt ? '1' : '0' })
      Object.defineProperty(navigator, 'globalPrivacyControl', { value: gpc })
    },
    { dnt, gpc },
  )
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'stats.test') {
      if (url.pathname === '/script.js') {
        loads++
        if (broken) return route.abort()
        return route.fulfill({ contentType: 'application/javascript', body: mockTracker })
      }
      events.push(route.request().postDataJSON())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    if (url.pathname === '/analytics-config.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: `export const analyticsConfig = ${JSON.stringify({ enabled, origin: 'https://stats.test', websiteId: id, domains: ['ritoko.com'] })}`,
      })
    if (url.pathname === '/analytics.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: readFileSync(new URL('../../site/analytics.js', import.meta.url), 'utf8'),
      })
    if (url.pathname === '/content-routes.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: readFileSync(new URL('../../site/content-routes.js', import.meta.url), 'utf8'),
      })
    if (url.pathname === '/analytics.css') return route.fulfill({ contentType: 'text/css', body: '' })
    return route.fulfill({ contentType: 'text/html', body: fixture })
  })
  const page = await context.newPage()
  await page.goto(`https://${host}${path}?email=secret#private`)
  return { context, page, events, loads: () => loads }
}

try {
  for (const options of [{ enabled: false }, { host: 'preview.vercel.app' }, { dnt: true }, { gpc: true }]) {
    const s = await session(options)
    assert.equal(await s.page.locator('.analytics-choice').count(), 0)
    assert.equal(s.loads(), 0)
    await s.context.close()
  }
  const s = await session()
  await s.page.getByRole('button', { name: 'Allow statistics' }).waitFor()
  assert.equal(s.loads(), 0, 'No tracker before consent')
  await s.page.getByRole('button', { name: 'No thanks' }).click()
  assert.equal(s.loads(), 0, 'No tracker after refusal')
  await s.page.getByRole('button', { name: 'Privacy settings' }).click()
  await s.page.getByRole('button', { name: 'Allow statistics' }).click()
  await s.page.waitForFunction(() => Boolean(window.umami))
  const copied = s.page.waitForResponse(
    (response) =>
      response.url().includes('/api/send') &&
      response.request().postDataJSON()?.name === 'install_copy_intent',
  )
  await s.page.getByRole('button', { name: 'Copy', exact: true }).click()
  await copied
  assert.equal(s.loads(), 1)
  assert(s.events.some((event) => event.name === 'install_copy_intent' && event.data.client === 'claude'))
  assert(
    s.events.some((event) => !event.name),
    'Pageview recorded',
  )
  assert(!JSON.stringify(s.events).includes('secret'), 'No query, fragment or title leakage')
  await s.page.getByRole('button', { name: 'Privacy settings' }).click()
  await s.page.getByRole('button', { name: 'No thanks' }).click()
  const count = s.events.length
  await s.page.getByRole('button', { name: 'Copy', exact: true }).click()
  assert.equal(s.events.length, count, 'Withdrawal prevents collection')
  await s.page.getByRole('button', { name: 'Privacy settings' }).click()
  await s.page.getByRole('button', { name: 'Allow statistics' }).click()
  const response = s.page.waitForResponse((r) => r.request().postDataJSON()?.name === 'install_copy_intent')
  await s.page.getByRole('button', { name: 'Copy', exact: true }).click()
  await response
  assert.equal(s.loads(), 1, 'Reaccepting does not duplicate tracker')
  await s.context.close()
  const routes = [
    contentRoutes.find((path) => path.startsWith('/guides/')),
    contentRoutes.find((path) => path.startsWith('/fr/guides/')),
    contentRoutes.find((path) => path.startsWith('/compare/')),
    '/faq',
    '/fr/faq',
  ]
  for (const path of routes) {
    assert(path, 'Build the authored site content before checking analytics routes')
    const known = await session({ path })
    const viewed = known.page.waitForResponse((response) => response.url().includes('/api/send'))
    await known.page.getByRole('button', { name: 'Allow statistics' }).click()
    await viewed
    assert.equal(known.loads(), 1, `Consent enables analytics on ${path}`)
    assert(!JSON.stringify(known.events).includes('secret'), 'Content route queries remain private')
    await known.context.close()
  }
  const unknown = await session({ path: '/private/customer-secret' })
  assert.equal(await unknown.page.locator('.analytics-choice').count(), 0)
  assert.equal(unknown.loads(), 0, 'Unknown paths never load analytics')
  await unknown.context.close()
  const failed = await session({ broken: true })
  await failed.page.getByRole('button', { name: 'Allow statistics' }).click()
  await failed.page.getByRole('button', { name: 'Copy', exact: true }).click()
  assert.equal(failed.events.length, 0)
  await failed.context.close()
  console.log(
    'Analytics browser checks passed: consent, withdrawal/reaccept, exclusions, sanitization, tracker failure.',
  )
} finally {
  await browser.close()
}
