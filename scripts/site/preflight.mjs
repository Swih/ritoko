import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const site = resolve(root, 'site')
const output = resolve(root, process.argv[2] ?? 'design/site-2026-10-04/preflight.json')
const files = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const name = resolve(path, entry.name)
    return entry.isDirectory() ? files(name) : [name]
  })
const errors = []
const pages = []
const all = files(site)
const sitemap = readFileSync(resolve(site, 'sitemap.xml'), 'utf8')
const sitemapUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])
const titles = new Set()
const descriptions = new Set()
for (const file of all.filter((name) => extname(name) === '.html')) {
  const html = readFileSync(file, 'utf8')
  const name = file.slice(site.length + 1).replaceAll('\\', '/')
  const route = name === 'index.html' ? '' : name.replace(/\.html$/, '')
  const expected = `https://ritoko.com/${route}`
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1]
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1]
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html)
  const complain = (message) => errors.push(`${name}: ${message}`)
  if (!title || !description) complain('missing title or description')
  if (canonical !== expected) complain(`incorrect canonical: ${canonical}`)
  if ((html.match(/<h1(?:\s|>)/g) ?? []).length !== 1) complain('expected one main heading')
  if (!noindex) {
    if (titles.has(title)) complain('duplicate title')
    if (descriptions.has(description)) complain('duplicate description')
    titles.add(title)
    descriptions.add(description)
    if (!sitemapUrls.includes(expected)) complain('indexable page missing from sitemap')
  } else if (sitemapUrls.includes(expected)) complain('noindex page included in sitemap')
  for (const match of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      const schema = JSON.parse(match[1])
      if (schema['@context'] !== 'https://schema.org') complain('unexpected structured data context')
    } catch {
      complain('invalid JSON-LD')
    }
  }
  for (const match of html.matchAll(/\b(?:src|href|poster)="([^"#][^"]*)"/g)) {
    const target = match[1]
    if (!target.startsWith('/') || target.startsWith('//')) continue
    const url = new URL(target, expected)
    const pathname = decodeURIComponent(url.pathname)
    const targetFile = resolve(site, `.${pathname === '/' ? '/index.html' : pathname}`)
    const actualFile = extname(targetFile) ? targetFile : `${targetFile}.html`
    if (!existsSync(actualFile)) complain(`missing internal target: ${target}`)
    else if (url.hash && extname(actualFile) === '.html') {
      const targetHtml = readFileSync(actualFile, 'utf8')
      if (!targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`))
        complain(`missing anchor: ${target}`)
    }
  }
  for (const match of html.matchAll(/<img\b([^>]+)>/g)) {
    if (!/\balt="[^"]*"/.test(match[1])) complain('image missing alternative text')
    if (!/\bwidth="\d+"/.test(match[1]) || !/\bheight="\d+"/.test(match[1]))
      complain('image missing intrinsic dimensions')
  }
  pages.push({ url: expected, file: name, title, description, indexable: !noindex })
}
if (new Set(sitemapUrls).size !== sitemapUrls.length) errors.push('duplicate sitemap URL')
if (sitemapUrls.length !== pages.filter((page) => page.indexable).length)
  errors.push('sitemap contains an unexpected URL')
const robots = readFileSync(resolve(site, 'robots.txt'), 'utf8')
for (const file of ['sitemap.xml', 'video-sitemap.xml']) {
  if (!robots.includes(`Sitemap: https://ritoko.com/${file}`)) errors.push(`robots.txt missing ${file}`)
}
for (const file of all) {
  if (/\.(env|map|ts|md)$/i.test(file) || /(?:^|[\\/])(?:auth|config|credentials)\.json$/i.test(file))
    errors.push(`private or source file in public bundle: ${file}`)
}
const result = {
  checkedAt: new Date().toISOString(),
  htmlPages: pages.length,
  indexablePages: sitemapUrls.length,
  totalFiles: all.length,
  totalBytes: all.reduce((sum, file) => sum + statSync(file).size, 0),
  pages,
  errors,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ ...result, pages: undefined }, null, 2))
if (errors.length) process.exitCode = 1
