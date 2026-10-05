import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Checks the built site. Usage: node scripts/site/preflight.mjs [report.json]
// A build made with SITE_SAMPLES=1 must be checked with SITE_SAMPLES=1 too: without it the sample marker
// "ritoko-sample" in the output is an error, which is how a committed sample build is caught.

const root = fileURLToPath(new URL('../../', import.meta.url))
const site = resolve(root, 'site')
const output = resolve(root, process.argv[2] ?? join(tmpdir(), 'ritoko-site-preflight.json'))
const samples = process.env.SITE_SAMPLES === '1'
const origin = 'https://ritoko.com'
const locales = { en: 'en_US', fr: 'fr_FR' }
const aiBots = [
  'OAI-SearchBot',
  'GPTBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
]
// Routes built from scripts/site/pages. Those pages get the stricter checks.
const generatedRoute = /^(?:fr\/)?(?:guides|compare|faq)(?:\/|$)/
const slugRoute = /^(?:fr\/)?(?:guides|compare)\/[^/]+$/
const contentRoute = /^(?:fr\/)?faq$|^(?:fr\/)?(?:guides|compare)\/[^/]+$/
const isoPattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/
const shortAnswerPattern = /<div class="short-answer"[^>]*><p class="overline">.*?<\/p><p>(.*?)<\/p>/s
const faqListPattern = /<div class="faq">(.*?)<\/div>/gs
const detailsPattern = /<details>\s*<summary>(.*?)<\/summary>\s*<p>(.*?)<\/p>\s*<\/details>/gs
const attributePattern = /([\w:-]+)="([^"]*)"/g
const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\xa0' }

const files = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const name = resolve(path, entry.name)
    return entry.isDirectory() ? files(name) : [name]
  })
const decodeEntities = (value) =>
  value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal, hex, word) => {
    if (decimal) return String.fromCodePoint(Number(decimal))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return named[word.toLowerCase()] ?? match
  })
// The text a reader sees: tags removed, entities decoded, white space collapsed.
const textOf = (html) => {
  const text = decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
  return text.replace(/[ \t\r\n]+/g, ' ').trim()
}
const validDate = (value) => {
  if (typeof value !== 'string' || !isoPattern.test(value)) return false
  const day = value.slice(0, 10)
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || Number.isNaN(Date.parse(value))) return false
  return date.toISOString().startsWith(day)
}
const inFuture = (value) => Date.parse(value) > Date.now() + 86_400_000
const attributes = (text) => {
  const pairs = [...text.matchAll(attributePattern)].map((match) => [match[1], match[2]])
  return Object.fromEntries(pairs)
}
const typesOf = (node) => [node['@type']].flat()
const routeOf = (pathname) => decodeURIComponent(pathname).replace(/^\/|\.html$|\/$/g, '')
const fileFor = (pathname) => {
  const target = resolve(site, `.${pathname === '/' ? '/index.html' : pathname}`)
  return extname(target) ? target : `${target}.html`
}
const graphNodes = (html) => {
  const nodes = []
  for (const match of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      const schema = JSON.parse(match[1])
      nodes.push(...(Array.isArray(schema['@graph']) ? schema['@graph'] : [schema]))
    } catch {
      // The structured data check reports invalid JSON-LD.
    }
  }
  return nodes
}
const linkTags = (html) => {
  const tags = [...html.matchAll(/<link\b([^>]*)>/g)]
  return tags.map((tag) => attributes(tag[1]))
}
const linkRoutes = (html) => {
  const routes = new Set()
  for (const match of html.matchAll(/<a\b[^>]*\bhref="(\/[^"]*)"/g)) {
    if (!match[1].startsWith('//')) routes.add(routeOf(new URL(match[1], origin).pathname))
  }
  return [...routes]
}
// The questions of the FAQ lists (<div class="faq">). Other <details> in a page are not part of a FAQ.
const visibleFaq = (html) => {
  const items = []
  for (const list of html.matchAll(faqListPattern)) {
    for (const match of list[1].matchAll(detailsPattern)) {
      const question = match[1].replace(/<span aria-hidden="true">.*?<\/span>/gs, '')
      items.push({ q: textOf(question), a: textOf(match[2]) })
    }
  }
  return items
}
const markedFaq = (nodes) => {
  const items = []
  for (const node of nodes) {
    if (!typesOf(node).includes('FAQPage')) continue
    for (const question of node.mainEntity ?? []) {
      const answer = question.acceptedAnswer?.text
      items.push({ q: textOf(String(question.name ?? '')), a: textOf(String(answer ?? '')) })
    }
  }
  return items
}

const errors = []
const pages = []
const all = files(site)
const sitemap = readFileSync(resolve(site, 'sitemap.xml'), 'utf8')
const sitemapEntries = [...sitemap.matchAll(/<url>(.*?)<\/url>/gs)].map((match) => ({
  loc: match[1].match(/<loc>(.*?)<\/loc>/)?.[1],
  lastmod: match[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1],
  alternates: [...match[1].matchAll(/<xhtml:link\b([^>]*)\/>/g)].map((link) => attributes(link[1])),
}))
const sitemapUrls = sitemapEntries.map((entry) => entry.loc)
const titles = new Set()
const descriptions = new Set()

const parse = (file) => {
  const html = readFileSync(file, 'utf8')
  const name = file.slice(site.length + 1).replaceAll('\\', '/')
  const route = name === 'index.html' ? '' : name.replace(/\.html$/, '')
  return {
    name,
    route,
    html,
    expected: `${origin}/${route}`,
    title: html.match(/<title>(.*?)<\/title>/s)?.[1],
    description: html.match(/<meta name="description" content="([^"]*)"/)?.[1],
    canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
    noindex: /<meta name="robots" content="[^"]*noindex/.test(html),
    lang: html.match(/<html lang="([^"]*)"/)?.[1],
    locale: html.match(/<meta property="og:locale" content="([^"]*)"/)?.[1],
    alternates: linkTags(html).filter((link) => link.rel === 'alternate' && link.hreflang),
    nodes: graphNodes(html),
    links: linkRoutes(html),
  }
}

const checkPage = (record, complain) => {
  const { title, description, canonical, expected, noindex, html, route, lang, locale } = record
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
  const language = route.startsWith('fr/') ? 'fr' : 'en'
  if (lang !== language) complain(`html lang is ${lang}, expected ${language}`)
  if (locale !== locales[language]) complain(`og:locale is ${locale}, expected ${locales[language]}`)
}

const checkArticle = (node, complain) => {
  for (const field of ['datePublished', 'dateModified']) {
    const value = node[field]
    if (value === undefined) continue
    if (!validDate(value)) complain(`${field} is not a valid ISO date: ${value}`)
    else if (inFuture(value)) complain(`${field} is in the future: ${value}`)
  }
  const { datePublished, dateModified } = node
  if (!datePublished) complain('Article has no datePublished')
  if (datePublished && dateModified && Date.parse(dateModified) < Date.parse(datePublished)) {
    complain('dateModified is earlier than datePublished')
  }
}

const checkFaq = (record, complain) => {
  const visible = visibleFaq(record.html)
  const marked = markedFaq(record.nodes)
  const hasNode = record.nodes.some((node) => typesOf(node).includes('FAQPage'))
  if (!hasNode) {
    if (generatedRoute.test(record.route) && visible.length > 0) {
      complain('the page shows a FAQ without FAQPage structured data')
    }
    return
  }
  if (visible.length === 0) complain('FAQPage structured data without a visible FAQ')
  if (marked.length !== visible.length) {
    complain(`FAQPage lists ${marked.length} questions, the page shows ${visible.length}`)
  }
  for (const [i, item] of marked.entries()) {
    const shown = visible[i]
    if (!shown) break
    if (item.q !== shown.q) complain(`FAQPage question ${i + 1} differs from the visible question`)
    if (item.a !== shown.a) complain(`FAQPage answer ${i + 1} differs from the visible answer`)
  }
}

const checkStructuredData = (record, complain) => {
  for (const match of record.html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      const schema = JSON.parse(match[1])
      if (schema['@context'] !== 'https://schema.org') complain('unexpected structured data context')
    } catch {
      complain('invalid JSON-LD')
    }
  }
  for (const node of record.nodes) {
    const types = typesOf(node)
    if (types.includes('Article') || types.includes('TechArticle')) checkArticle(node, complain)
  }
  checkFaq(record, complain)
}

const checkLinks = (record, complain) => {
  const { html, expected, route } = record
  for (const match of html.matchAll(/\b(?:src|href|poster)="([^"#][^"]*)"/g)) {
    const target = match[1]
    if (!target.startsWith('/') || target.startsWith('//')) continue
    const url = new URL(target, expected)
    const actualFile = fileFor(decodeURIComponent(url.pathname))
    if (!existsSync(actualFile)) complain(`missing internal target: ${target}`)
    else if (url.hash && extname(actualFile) === '.html') {
      const targetHtml = readFileSync(actualFile, 'utf8')
      if (!targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)) {
        complain(`missing anchor: ${target}`)
      }
    }
  }
  if (!generatedRoute.test(route)) return
  for (const match of html.matchAll(/\bhref="#([^"]+)"/g)) {
    if (!html.includes(`id="${match[1]}"`)) complain(`missing anchor: #${match[1]}`)
  }
}

const checkImages = (record, complain) => {
  for (const match of record.html.matchAll(/<img\b([^>]+)>/g)) {
    if (!/\balt="[^"]*"/.test(match[1])) complain('image missing alternative text')
    if (!/\bwidth="\d+"/.test(match[1]) || !/\bheight="\d+"/.test(match[1])) {
      complain('image missing intrinsic dimensions')
    }
  }
}

const isDated = (node) => typesOf(node).some((type) => type === 'Article' || type === 'FAQPage')
// Pages built from page data: length limits, the short answer block, dates shown and marked up, breadcrumbs.
const checkGenerated = (record, complain) => {
  const { route, html, nodes, expected, lang } = record
  const title = textOf(record.title ?? '')
  const description = textOf(record.description ?? '')
  if (title.length > 65) complain(`title is ${title.length} characters, the limit is 65`)
  if (description.length < 70 || description.length > 160) {
    complain(`description is ${description.length} characters, expected 70 to 160`)
  }
  const breadcrumb = nodes.find((node) => typesOf(node).includes('BreadcrumbList'))
  if (breadcrumb?.itemListElement?.at(-1)?.item !== expected) {
    complain('BreadcrumbList is missing or does not end with this page')
  }
  if (!contentRoute.test(route)) return
  const dated = nodes.find(isDated)
  if (!dated?.dateModified) complain('no dateModified in the structured data')
  const entry = sitemapEntries.find((item) => item.loc === expected)
  if (entry && dated && entry.lastmod !== dated.dateModified) {
    complain('sitemap lastmod differs from dateModified')
  }
  const shown = html.match(/<p class="guide-dates[^"]*">(.*?)<\/p>/s)?.[1] ?? ''
  const times = [...shown.matchAll(/<time datetime="([^"]+)"/g)].map((match) => match[1])
  for (const field of ['datePublished', 'dateModified']) {
    if (dated?.[field] && !times.includes(dated[field])) complain(`${field} is not shown on the page`)
  }
  if (!slugRoute.test(route)) return
  if ((html.match(/class="short-answer"/g) ?? []).length !== 1) complain('expected one short answer block')
  const answer = html.match(shortAnswerPattern)?.[1]
  const words = answer ? textOf(answer).split(' ').length : 0
  if (words > 80) complain(`the short answer is ${words} words, the limit is 80`)
  const articles = nodes.filter((node) => typesOf(node).includes('Article'))
  if (articles.length !== 1) complain(`expected one Article, found ${articles.length}`)
  const article = articles[0]
  if (!article) return
  if (article.inLanguage !== lang) complain(`Article inLanguage is ${article.inLanguage}, expected ${lang}`)
  if (article.mainEntityOfPage?.['@id'] !== expected) complain('Article mainEntityOfPage is not this page')
}

const records = all.filter((name) => extname(name) === '.html').map(parse)
for (const record of records) {
  const complain = (message) => errors.push(`${record.name}: ${message}`)
  checkPage(record, complain)
  checkStructuredData(record, complain)
  checkLinks(record, complain)
  checkImages(record, complain)
  if (generatedRoute.test(record.route)) checkGenerated(record, complain)
  pages.push({
    url: record.expected,
    file: record.name,
    title: record.title,
    description: record.description,
    indexable: !record.noindex,
  })
}

const bad = (message) => errors.push(`sitemap.xml: ${message}`)
if (new Set(sitemapUrls).size !== sitemapUrls.length) errors.push('duplicate sitemap URL')
if (sitemapUrls.length !== pages.filter((page) => page.indexable).length) {
  errors.push('sitemap contains an unexpected URL')
}
for (const entry of sitemapEntries) {
  if (!entry.lastmod) bad(`${entry.loc} has no <lastmod>`)
  else if (!validDate(entry.lastmod)) bad(`${entry.loc} lastmod is not an ISO date: ${entry.lastmod}`)
  else if (inFuture(entry.lastmod)) bad(`${entry.loc} lastmod is in the future: ${entry.lastmod}`)
}
const usesAlternates = sitemapEntries.some((entry) => entry.alternates.length > 0)
if (usesAlternates && !sitemap.includes('xmlns:xhtml=')) bad('xhtml:link without xmlns:xhtml')

// hreflang: every alternate set names the page itself and an x-default, points to built pages that list the
// same set, matches each target's html lang, and the sitemap repeats the same alternates.
const alternateKey = (alternate) => `${alternate.hreflang} ${alternate.href}`
const byUrl = new Map(records.map((record) => [record.expected, record]))
for (const record of records) {
  const complain = (message) => errors.push(`${record.name}: ${message}`)
  const { alternates, expected, lang } = record
  const entry = sitemapEntries.find((item) => item.loc === expected)
  const mine = new Set(alternates.map(alternateKey))
  if (entry) {
    const listed = new Set(entry.alternates.map(alternateKey))
    if (listed.size !== mine.size || [...mine].some((item) => !listed.has(item))) {
      complain('sitemap alternates differ from the hreflang links of the page')
    }
  }
  if (alternates.length === 0) continue
  const own = alternates.find((alternate) => alternate.href === expected)
  if (!own) complain('hreflang links do not include the page itself')
  else if (own.hreflang !== lang) complain(`the self hreflang is ${own.hreflang}, the page is ${lang}`)
  const hasDefault = alternates.some((alternate) => alternate.hreflang === 'x-default')
  if (!hasDefault) complain('no hreflang x-default')
  for (const alternate of alternates) {
    const target = byUrl.get(alternate.href)
    if (!target) {
      complain(`hreflang target is not a built page: ${alternate.href}`)
      continue
    }
    if (alternate.hreflang !== 'x-default' && alternate.hreflang !== target.lang) {
      complain(`hreflang ${alternate.hreflang} points to a page in ${target.lang}: ${alternate.href}`)
    }
    const theirs = new Set(target.alternates.map(alternateKey))
    if (theirs.size !== mine.size || [...mine].some((item) => !theirs.has(item))) {
      complain(`hreflang links are not reciprocal with ${alternate.href}`)
    }
  }
}

// Every generated page needs an inbound internal link, and a path of links from the home page.
const inbound = new Map(records.map((record) => [record.route, 0]))
for (const record of records) {
  for (const route of record.links) {
    if (route !== record.route && inbound.has(route)) inbound.set(route, inbound.get(route) + 1)
  }
}
const graph = new Map(records.map((record) => [record.route, record.links]))
const reached = new Set([''])
const queue = ['']
while (queue.length > 0) {
  for (const next of graph.get(queue.shift()) ?? []) {
    if (graph.has(next) && !reached.has(next)) {
      reached.add(next)
      queue.push(next)
    }
  }
}
for (const record of records.filter((item) => generatedRoute.test(item.route))) {
  if (inbound.get(record.route) === 0) errors.push(`${record.name}: no inbound internal link`)
  else if (!reached.has(record.route)) errors.push(`${record.name}: not reachable from the home page`)
}

// llms.txt and llms-full.txt: every link on this site resolves, and every content page is listed.
for (const name of ['llms.txt', 'llms-full.txt']) {
  const file = resolve(site, name)
  if (!existsSync(file)) {
    errors.push(`${name} is missing`)
    continue
  }
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/https:\/\/ritoko\.com\/[^\s)\]]*/g)) {
    const url = match[0].replace(/[.,;:]+$/, '')
    if (!existsSync(fileFor(new URL(url).pathname))) errors.push(`${name}: link does not resolve: ${url}`)
  }
  for (const record of records.filter((item) => contentRoute.test(item.route))) {
    if (!text.includes(record.expected)) errors.push(`${name} does not list ${record.expected}`)
  }
}

const robots = readFileSync(resolve(site, 'robots.txt'), 'utf8')
for (const file of ['sitemap.xml', 'video-sitemap.xml']) {
  if (!robots.includes(`Sitemap: https://ritoko.com/${file}`)) errors.push(`robots.txt missing ${file}`)
}
// The rules of every user agent, from the groups of robots.txt.
const robotRules = new Map()
let agents = []
let listing = true
for (const raw of robots.split('\n')) {
  const stripped = raw.replace(/#.*/, '').trim()
  const line = stripped.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
  if (!line) continue
  const field = line[1].toLowerCase()
  if (field === 'user-agent') {
    if (!listing) agents = []
    listing = true
    agents.push(line[2])
    for (const agent of agents) {
      if (!robotRules.has(agent)) robotRules.set(agent, [])
    }
  } else if (field === 'allow' || field === 'disallow') {
    listing = false
    for (const agent of agents) robotRules.get(agent).push(`${field}: ${line[2]}`)
  }
}
for (const agent of ['*', ...aiBots]) {
  const rules = robotRules.get(agent) ?? []
  if (!rules.includes('allow: /')) errors.push(`robots.txt does not allow ${agent}`)
  if (rules.some((rule) => rule.startsWith('disallow:') && rule.slice(9).trim() !== '')) {
    errors.push(`robots.txt disallows a path for ${agent}`)
  }
}

const isText = (file) => /\.(?:html|xml|txt|json)$/i.test(file)
for (const file of all) {
  const name = file.slice(site.length + 1).replaceAll('\\', '/')
  if (/\.(env|map|ts|md)$/i.test(file) || /(?:^|[\\/])(?:auth|config|credentials)\.json$/i.test(file)) {
    errors.push(`private or source file in public bundle: ${file}`)
  }
  if (!samples && isText(file) && /ritoko-sample/i.test(readFileSync(file, 'utf8'))) {
    errors.push(`${name}: contains the sample marker "ritoko-sample" but SITE_SAMPLES is not 1`)
  }
}

const result = {
  checkedAt: new Date().toISOString(),
  samples,
  htmlPages: pages.length,
  indexablePages: sitemapUrls.length,
  generatedPages: records.filter((record) => generatedRoute.test(record.route)).length,
  totalFiles: all.length,
  totalBytes: all.reduce((sum, file) => sum + statSync(file).size, 0),
  pages,
  errors,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ ...result, pages: undefined }, null, 2))
if (errors.length) process.exitCode = 1
