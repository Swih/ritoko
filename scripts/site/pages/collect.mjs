import { comparisonPages } from './comparisons.mjs'
import { faqGroups, faqPage } from './faq.mjs'
import { faqGroupsFr, faqPageFr } from './fr/faq.mjs'
import { problemPagesFr } from './fr/problems.mjs'
import { problemPages } from './problems.mjs'

// Loads the page data modules (and _sample.mjs when asked), validates them and derives each page's route,
// language alternates and last-modified date. Everything generated from page data (the pages, the sitemap,
// the llms files and the navigation links) reads the one list returned here. The contract is in ./types.mjs.

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const markupPattern = /<\/?[a-z]|&(?:#\d+|#x[\da-f]+|[a-z]+);/i
const ownedTags = /^(?:article|base|body|footer|head|header|html|link|main|meta|nav|section|title)$/
const blockedTags = /^(?:form|h[12]|iframe|script|style)$/
const inlineTags = new Set(['a', 'strong', 'em', 'code', 'br'])
const voidTags = new Set(['br', 'hr', 'img', 'wbr'])
const reservedIds = new Set(['faq', 'sources', 'related', 'short-answer'])
const pageKeys = new Set([
  'slug',
  'lang',
  'metaTitle',
  'description',
  'h1',
  'shortAnswer',
  'sections',
  'faq',
  'table',
  'related',
  'sources',
  'datePublished',
  'dateModified',
  'tags',
  'twin',
])
const dateKeys = ['datePublished', 'dateModified']
const textFields = ['metaTitle', 'description', 'h1', 'shortAnswer']
const faqPageKeys = new Set([...textFields, ...dateKeys])
const faqGroupKeys = new Set(['id', 'heading', 'intro', 'items'])
const faqItemKeys = new Set(['q', 'a'])
const sectionKeys = new Set(['id', 'heading', 'html'])
const tableKeys = new Set(['caption', 'columns', 'rows', 'rowHeaders', 'note'])
const sourceKeys = new Set(['label', 'url', 'retrieved'])

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isSlug = (value) => typeof value === 'string' && slugPattern.test(value)
const isOneLine = (value) => !/[\r\n\t]| {2}/.test(value) && value === value.trim()
const isDate = (value) => {
  if (typeof value !== 'string' || !datePattern.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}
const isHttps = (value) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
const listOf = (value) => (Array.isArray(value) ? value : [])
const tagsIn = (html) =>
  [...html.matchAll(/<(\/?)([a-z][a-z\d]*)\b[^>]*?(\/?)>/gi)].map((match) => ({
    closing: match[1] === '/',
    name: match[2].toLowerCase(),
    selfClosing: match[3] === '/',
  }))
const isBalanced = (tags) => {
  const open = []
  for (const tag of tags) {
    if (voidTags.has(tag.name) || tag.selfClosing) continue
    if (!tag.closing) open.push(tag.name)
    else if (open.pop() !== tag.name) return false
  }
  return open.length === 0
}

const checkKeys = (value, allowed, name, fail) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${name} has the unknown field "${key}"`)
  }
}
const checkText = (value, name, fail) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`)
  else if (!isOneLine(value)) fail(`${name} must be one line, without repeated or edge spaces`)
  else if (markupPattern.test(value)) fail(`${name} is plain text: remove the html tags and entities`)
}
const checkHtml = (value, name, fail, inline) => {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${name} must be a non-empty string`)
    return
  }
  const tags = tagsIn(value)
  for (const tag of new Set(tags.map((item) => item.name))) {
    if (inline && !inlineTags.has(tag)) fail(`${name} may only use inline tags, found <${tag}>`)
    if (!inline && (ownedTags.test(tag) || blockedTags.test(tag))) fail(`${name} must not use <${tag}>`)
  }
  if (!isBalanced(tags)) fail(`${name} has an unclosed or mismatched tag`)
}
const checkDates = (value, fail) => {
  if (!isDate(value.datePublished)) fail('datePublished must be a real ISO date (YYYY-MM-DD)')
  if (!isDate(value.dateModified)) fail('dateModified must be a real ISO date (YYYY-MM-DD)')
  else if (isDate(value.datePublished) && value.dateModified < value.datePublished)
    fail('dateModified must not be earlier than datePublished')
}
const checkFaqItems = (items, name, fail) => {
  const list = listOf(items)
  if (list.length === 0) fail(`${name} must be a non-empty array`)
  for (const [i, item] of list.entries()) {
    checkKeys(isObject(item) ? item : {}, faqItemKeys, `${name}[${i}]`, fail)
    checkText(item?.q, `${name}[${i}].q`, fail)
    checkHtml(item?.a, `${name}[${i}].a`, fail, true)
  }
}

const checkTable = (table, fail) => {
  checkKeys(table, tableKeys, 'table', fail)
  checkText(table.caption, 'table.caption', fail)
  const columns = listOf(table.columns)
  if (columns.length === 0) fail('table.columns must be a non-empty array')
  for (const [i, column] of columns.entries()) checkText(column, `table.columns[${i}]`, fail)
  const rows = listOf(table.rows)
  if (rows.length === 0) fail('table.rows must be a non-empty array')
  for (const [r, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== columns.length) {
      fail(`table.rows[${r}] must have one cell per column (${columns.length})`)
      continue
    }
    for (const [c, cell] of row.entries()) checkHtml(cell, `table.rows[${r}][${c}]`, fail, true)
  }
  const headers = table.rowHeaders
  if (headers !== undefined && typeof headers !== 'boolean') fail('table.rowHeaders must be true or false')
  if (table.note !== undefined) checkText(table.note, 'table.note', fail)
}

const checkSections = (sections, fail) => {
  const list = listOf(sections)
  if (list.length === 0) fail('sections must be a non-empty array')
  const seen = new Set(reservedIds)
  for (const [i, section] of list.entries()) {
    const name = `sections[${i}]`
    checkKeys(isObject(section) ? section : {}, sectionKeys, name, fail)
    if (!isSlug(section?.id)) fail(`${name}.id must be kebab-case`)
    else if (seen.has(section.id)) fail(`${name}.id "${section.id}" is reserved or repeated`)
    else seen.add(section.id)
    checkText(section?.heading, `${name}.heading`, fail)
    checkHtml(section?.html, `${name}.html`, fail, false)
    for (const match of String(section?.html ?? '').matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(match[1])) fail(`${name}.html repeats the id "${match[1]}"`)
      seen.add(match[1])
    }
  }
}

const checkSources = (sources, required, fail) => {
  const list = listOf(sources)
  if (required && list.length === 0) fail('sources needs at least one entry')
  for (const [i, source] of list.entries()) {
    const name = `sources[${i}]`
    checkKeys(isObject(source) ? source : {}, sourceKeys, name, fail)
    checkText(source?.label, `${name}.label`, fail)
    if (!isHttps(source?.url)) fail(`${name}.url must be an absolute https URL`)
    if (!isDate(source?.retrieved)) fail(`${name}.retrieved must be a real ISO date (YYYY-MM-DD)`)
  }
}

const checkPage = (page, lang, comparison, errors) => {
  const fail = (message) => errors.push(`${lang}/${page?.slug}: ${message}`)
  if (!isObject(page)) {
    fail('is not an object')
    return
  }
  checkKeys(page, pageKeys, 'page', fail)
  if (!isSlug(page.slug)) fail('slug must be kebab-case: a-z, 0-9 and hyphens')
  if (page.lang !== lang) fail(`lang must be '${lang}' in this module`)
  for (const field of textFields) checkText(page[field], field, fail)
  checkSections(page.sections, fail)
  if (page.faq !== undefined) checkFaqItems(page.faq, 'faq', fail)
  if (page.table !== undefined) checkTable(isObject(page.table) ? page.table : {}, fail)
  checkSources(page.sources, comparison, fail)
  checkDates(page, fail)
  if (page.twin !== undefined && !isSlug(page.twin)) fail('twin must be kebab-case')
  if (page.twin !== undefined && comparison) fail('comparisons are English only and cannot have a twin')
  for (const field of ['related', 'tags']) {
    if (page[field] !== undefined && !Array.isArray(page[field])) fail(`${field} must be an array`)
  }
  for (const [i, tag] of listOf(page.tags).entries()) checkText(tag, `tags[${i}]`, fail)
}

const checkFaq = (groups, page, lang, errors) => {
  const fail = (message) => errors.push(`${lang}/faq: ${message}`)
  if (groups.length === 0) {
    if (page) fail('the page fields are set but there are no groups')
    return
  }
  if (!isObject(page)) {
    fail('the page fields (faqPage, faqPageFr) are required when there are groups')
    return
  }
  checkKeys(page, faqPageKeys, 'page', fail)
  for (const field of textFields) {
    if (field !== 'shortAnswer' || page.shortAnswer !== undefined) checkText(page[field], field, fail)
  }
  checkDates(page, fail)
  const seen = new Set()
  for (const [i, group] of groups.entries()) {
    const name = `groups[${i}]`
    checkKeys(isObject(group) ? group : {}, faqGroupKeys, name, fail)
    if (!isSlug(group?.id)) fail(`${name}.id must be kebab-case`)
    else if (seen.has(group.id)) fail(`${name}.id "${group.id}" is repeated`)
    else seen.add(group.id)
    checkText(group?.heading, `${name}.heading`, fail)
    if (group?.intro !== undefined) checkText(group.intro, `${name}.intro`, fail)
    checkFaqItems(group?.items, `${name}.items`, fail)
  }
}

// Checks that need every page at once: unique slugs, related targets and twin keys.
const checkAcross = (data, errors) => {
  for (const lang of ['en', 'fr']) {
    const pool = [...data[lang].guides, ...data[lang].comparisons].filter(isObject)
    const note = (page, message) => errors.push(`${lang}/${page.slug}: ${message}`)
    const slugs = new Set()
    for (const page of pool) {
      if (slugs.has(page.slug)) note(page, 'the slug is used by more than one page in this language')
      slugs.add(page.slug)
    }
    const twins = new Set()
    for (const page of pool) {
      for (const slug of listOf(page.related)) {
        if (slug === page.slug) note(page, 'related lists the page itself')
        else if (!slugs.has(slug)) note(page, `related "${slug}" is not a page in ${lang}`)
      }
      if (page.twin === undefined) continue
      if (twins.has(page.twin)) note(page, `the twin key "${page.twin}" is used by two pages`)
      twins.add(page.twin)
    }
  }
}

const withSample = (list, name, extra) => {
  if (!Array.isArray(list)) throw new Error(`${name} must be an array`)
  return [...list, ...(extra ?? [])]
}
const newest = (items) => {
  const dates = items.map((item) => item.dateModified)
  return dates.sort().at(-1)
}
const alternatesOf = (en, fr) => [
  { hreflang: 'en', route: en.route },
  { hreflang: 'fr', route: fr.route },
  { hreflang: 'x-default', route: en.route },
]
const pair = (en, fr) => {
  if (!en || !fr) return
  en.alternates = alternatesOf(en, fr)
  fr.alternates = alternatesOf(en, fr)
}
const decorate = (page, kind, route) => ({
  ...page,
  kind,
  route,
  alternates: [],
  lastmod: page.dateModified,
})

export async function loadPages({ samples = false } = {}) {
  const sample = samples ? (await import('./_sample.mjs')).samplePages : {}
  const data = {
    en: {
      guides: withSample(problemPages, 'problemPages', sample.problemPages),
      comparisons: withSample(comparisonPages, 'comparisonPages', sample.comparisonPages),
      groups: withSample(faqGroups, 'faqGroups', sample.faqGroups),
      page: faqPage ?? sample.faqPage ?? null,
    },
    fr: {
      guides: withSample(problemPagesFr, 'problemPagesFr', sample.problemPagesFr),
      comparisons: [],
      groups: withSample(faqGroupsFr, 'faqGroupsFr', sample.faqGroupsFr),
      page: faqPageFr ?? sample.faqPageFr ?? null,
    },
  }

  const errors = []
  for (const lang of ['en', 'fr']) {
    for (const page of data[lang].guides) checkPage(page, lang, false, errors)
    for (const page of data[lang].comparisons) checkPage(page, lang, true, errors)
    checkFaq(data[lang].groups, data[lang].page, lang, errors)
  }
  checkAcross(data, errors)
  if (errors.length > 0) {
    const list = errors.map((error) => `  - ${error}`).join('\n')
    throw new Error(`Invalid page data (${errors.length}):\n${list}`)
  }

  const guideRoute = (page) => `${page.lang === 'fr' ? 'fr/' : ''}guides/${page.slug}`
  const guides = {
    en: data.en.guides.map((page) => decorate(page, 'guide', guideRoute(page))),
    fr: data.fr.guides.map((page) => decorate(page, 'guide', guideRoute(page))),
  }
  const comparisons = data.en.comparisons.map((page) => decorate(page, 'compare', `compare/${page.slug}`))
  const frenchTwins = new Map(guides.fr.filter((page) => page.twin).map((page) => [page.twin, page]))
  for (const page of guides.en) pair(page, frenchTwins.get(page.twin))

  const index = (collection, lang, items) => {
    if (items.length === 0) return null
    const route = `${lang === 'fr' ? 'fr/' : ''}${collection}`
    return { kind: 'index', collection, lang, route, items, alternates: [], lastmod: newest(items) }
  }
  const indexes = {
    guides: { en: index('guides', 'en', guides.en), fr: index('guides', 'fr', guides.fr) },
    compare: index('compare', 'en', comparisons),
  }
  pair(indexes.guides.en, indexes.guides.fr)

  const faqEntry = (lang) => {
    const { groups, page } = data[lang]
    if (groups.length === 0) return null
    return { ...decorate(page, 'faq', lang === 'fr' ? 'fr/faq' : 'faq'), lang, groups }
  }
  const faq = { en: faqEntry('en'), fr: faqEntry('fr') }
  pair(faq.en, faq.fr)

  const entries = [
    indexes.guides.en,
    ...guides.en,
    indexes.compare,
    ...comparisons,
    faq.en,
    indexes.guides.fr,
    ...guides.fr,
    faq.fr,
  ].filter(Boolean)
  return { guides, comparisons, faq, index: indexes, entries, samples }
}
