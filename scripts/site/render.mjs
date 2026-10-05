// Templates for the pages generated from page data (guides, comparisons, FAQ and their indexes), the home
// page section, sitemap.xml and the llms files. Plain text fields are escaped here. The html fields were
// checked by pages/collect.mjs. build.mjs passes in the page chrome: head, header, footer and businessCta.

const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (char) => escapes[char])

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\xa0' }
const decodeEntity = (match, decimal, hex, name) => {
  if (decimal) return String.fromCodePoint(Number(decimal))
  if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
  return entities[name.toLowerCase()] ?? match
}
// The text a reader sees for an inline html fragment. JSON-LD answers and the llms files use it.
export const plainText = (html) =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, decodeEntity)
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()

const monthNames = {
  en: 'January February March April May June July August September October November December'.split(' '),
  fr: 'janvier février mars avril mai juin juillet août septembre octobre novembre décembre'.split(' '),
}
// Month names are spelled out so the output does not depend on the ICU data of the Node build.
export const formatDate = (iso, lang) => {
  const [year, month, day] = iso.split('-').map(Number)
  const dayText = lang === 'fr' && day === 1 ? '1er' : String(day)
  return `${dayText} ${monthNames[lang][month - 1]} ${year}`
}

// Labels of the generated pages. Comparisons are English only, so the French set has no comparison labels.
export const copy = {
  en: {
    locale: 'en_US',
    skip: 'Skip to content',
    ogAlt: 'Ritoko: a saved workflow and a journal of checked results',
    language: 'English',
    switchTo: 'Read this page in English',
    navGuides: 'Guides',
    navCompare: 'Compare',
    allGuides: '← All guides',
    allCompare: '← All comparisons',
    kindGuide: 'Guide',
    kindCompare: 'Comparison',
    shortAnswer: 'Short answer',
    updated: 'Updated',
    published: 'Published',
    checked: 'Sources checked',
    faq: 'Frequently asked questions',
    groups: 'Question groups',
    sources: 'Sources',
    retrieved: 'Retrieved',
    related: 'Related',
    allQuestions: 'All questions and answers',
  },
  fr: {
    locale: 'fr_FR',
    skip: 'Aller au contenu',
    ogAlt: 'Ritoko\xa0: un workflow enregistré et un journal de résultats vérifiés',
    language: 'Français',
    switchTo: 'Lire en français',
    navGuides: 'Guides',
    allGuides: '← Tous les guides',
    kindGuide: 'Guide',
    shortAnswer: 'Réponse courte',
    updated: 'Mis à jour le',
    published: 'Publié le',
    faq: 'Questions fréquentes',
    groups: 'Groupes de questions',
    sources: 'Sources',
    retrieved: 'Consultée le',
    related: 'À lire aussi',
    allQuestions: 'Toutes les questions et réponses',
  },
}

// Titles, descriptions and headings of the index pages. They are template copy, not page data.
const indexCopy = {
  guides: {
    en: {
      title: 'Guides for repeated browser and API agent tasks — Ritoko',
      description:
        'Short answers to common problems with repeated browser, API and MCP tasks run by an AI agent, and what Ritoko does and does not do about each.',
      h1: 'Problems with repeated agent tasks, answered',
      lede: 'Each guide opens with a short answer, then goes into the details.',
    },
    fr: {
      title: 'Guides sur les tâches répétées d’un agent IA — Ritoko',
      description:
        'Réponses courtes aux problèmes courants des tâches répétées (navigateur, API, MCP) confiées à un agent IA, et ce que Ritoko fait ou ne fait pas.',
      h1: 'Les problèmes des tâches répétées, expliqués',
      lede: 'Chaque guide commence par une réponse courte, puis entre dans le détail.',
    },
  },
  compare: {
    en: {
      title: 'Compare browser automation tools for agents — Ritoko',
      description:
        'Side-by-side comparisons of Ritoko and other tools for repeating browser tasks. Each page cites its sources and the date they were checked.',
      h1: 'Ritoko compared with other tools',
      lede: 'Which tool fits which job. Each page cites its sources and the date they were checked.',
    },
  },
}

const homeLimit = 6
const timeTag = (iso, lang) => `<time datetime="${iso}">${formatDate(iso, lang)}</time>`
const focusablePre = (html) => html.replace(/<pre(?![^>]*\btabindex)/g, '<pre tabindex="0"')
const siblings = (content, lang) => {
  const comparisons = lang === 'en' ? content.comparisons : []
  return [...content.guides[lang], ...comparisons]
}
const faqOf = (content, lang) => (content.faq[lang] ? [content.faq[lang]] : [])

// A link to the other language's version of the page, when the data says there is one.
const languageSwitch = (entry) => {
  const languages = entry.alternates.filter((alt) => alt.hreflang !== 'x-default')
  const other = languages.find((alt) => alt.hreflang !== entry.lang)
  if (!other) return ''
  const label = copy[other.hreflang].switchTo
  return `<a class="text-link lang-switch" href="/${other.route}" hreflang="${other.hreflang}" lang="${other.hreflang}">${label}</a>`
}

const alternateLinks = (origin, entry) =>
  entry.alternates.map(({ hreflang, route }) => ({ hreflang, href: `${origin}/${route}` }))

const card = (item, level) =>
  `<a class="problem-card" href="/${item.route}"><h${level}>${escapeHtml(item.h1)}</h${level}><p>${escapeHtml(item.shortAnswer)}</p><span aria-hidden="true">↗</span></a>`

const detail = ({ q, a }) =>
  `<details><summary>${escapeHtml(q)}<span aria-hidden="true">＋</span></summary><p>${a}</p></details>`
const detailsList = (items) => `<div class="faq">${items.map(detail).join('')}</div>`

const shortAnswerBlock = (page) =>
  `<div class="short-answer" id="short-answer"><p class="overline">${copy[page.lang].shortAnswer}</p><p>${escapeHtml(page.shortAnswer)}</p></div>`

const datesLine = (page) => {
  const text = copy[page.lang]
  const parts = [`${text.updated} ${timeTag(page.dateModified, page.lang)}`]
  if (page.datePublished !== page.dateModified) {
    parts.push(`${text.published} ${timeTag(page.datePublished, page.lang)}`)
  }
  if (page.kind === 'compare') {
    const retrieved = page.sources.map((source) => source.retrieved)
    parts.push(`${text.checked} ${timeTag(retrieved.sort().at(-1), page.lang)}`)
  }
  return `<p class="guide-dates small">${parts.join(' · ')}</p>`
}

const bodyCell = (html, first, rowHeaders) =>
  first && rowHeaders ? `<th scope="row">${html}</th>` : `<td>${html}</td>`
const tableRow = (row, rowHeaders) =>
  `<tr>${row.map((html, i) => bodyCell(html, i === 0, rowHeaders)).join('')}</tr>`
const tableBlock = (table) => {
  const caption = escapeHtml(table.caption)
  const columns = table.columns.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join('')
  const rows = table.rows.map((row) => tableRow(row, table.rowHeaders !== false)).join('')
  const note = table.note ? `<p class="small compare-note">${escapeHtml(table.note)}</p>` : ''
  const region = `<div class="compare-table" role="region" aria-label="${caption}" tabindex="0">`
  return `${region}<table><caption>${caption}</caption><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table></div>${note}`
}

const sectionBlock = ({ id, heading, html }) =>
  `<section class="guide-section" id="${id}"><h2>${escapeHtml(heading)}</h2>${focusablePre(html)}</section>`

const faqBlock = (page) => {
  if (!page.faq?.length) return ''
  return `<section class="guide-section guide-faq" id="faq"><h2>${copy[page.lang].faq}</h2>${detailsList(page.faq)}</section>`
}

const sourceItem = (source, lang) => {
  const link = `<a href="${escapeHtml(source.url)}">${escapeHtml(source.label)}</a>`
  return `<li>${link}<span class="small">${copy[lang].retrieved} ${timeTag(source.retrieved, lang)}</span></li>`
}
const sourcesBlock = (page) => {
  if (!page.sources?.length) return ''
  const items = page.sources.map((source) => sourceItem(source, page.lang)).join('')
  return `<section class="guide-section" id="sources"><h2>${copy[page.lang].sources}</h2><ul class="sources-list">${items}</ul></section>`
}

const relatedBlock = (content, page) => {
  const pool = siblings(content, page.lang)
  const targets = (page.related ?? []).map((slug) => pool.find((item) => item.slug === slug))
  if (targets.length === 0) return ''
  const cards = targets.map((item) => card(item, 3)).join('')
  return `<section class="guide-related" id="related"><h2>${copy[page.lang].related}</h2><div class="problem-grid">${cards}</div></section>`
}

const organization = (origin) => ({ '@id': `${origin}/#organization` })
const breadcrumbNode = (origin, url, trail) => ({
  '@type': 'BreadcrumbList',
  '@id': `${url}#breadcrumb`,
  itemListElement: trail.map(([name, route], i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name,
    item: `${origin}/${route}`,
  })),
})
const articleNode = (origin, page, url) => ({
  '@type': 'Article',
  '@id': `${url}#article`,
  headline: page.h1,
  description: page.description,
  datePublished: page.datePublished,
  dateModified: page.dateModified,
  author: organization(origin),
  publisher: organization(origin),
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  inLanguage: page.lang,
  image: [`${origin}/assets/og-cadence.png`],
  ...(page.tags?.length ? { keywords: page.tags.join(', ') } : {}),
  ...(page.sources?.length ? { citation: page.sources.map((source) => source.url) } : {}),
})
// Only the questions that are shown on the page, with the same text.
const faqNode = (page, url, items) => ({
  '@type': 'FAQPage',
  '@id': `${url}#faq`,
  url,
  inLanguage: page.lang,
  mainEntity: items.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: plainText(a) },
  })),
})

export function renderGuide(ctx, page) {
  const { head, header, footer, businessCta, origin, content } = ctx
  const text = copy[page.lang]
  const url = `${origin}/${page.route}`
  const compare = page.kind === 'compare'
  const parent = compare ? content.index.compare : content.index.guides[page.lang]
  const collection = compare ? text.navCompare : text.navGuides
  const trail = [
    ['Ritoko', ''],
    [collection, parent.route],
    [page.h1, page.route],
  ]
  const structured = [articleNode(origin, page, url)]
  if (page.faq?.length) structured.push(faqNode(page, url, page.faq))
  structured.push(breadcrumbNode(origin, url, trail))
  const article = { published: page.datePublished, modified: page.dateModified }
  const options = { lang: page.lang, alternates: alternateLinks(origin, page), article }
  const title = escapeHtml(page.metaTitle)
  const description = escapeHtml(page.description)
  const meta = head(title, description, page.route, structured, false, options)

  const back = compare ? text.allCompare : text.allGuides
  const topRow = `<div class="page-meta"><a class="text-link" href="/${parent.route}">${back}</a>${languageSwitch(page)}</div>`
  const kind = compare ? text.kindCompare : text.kindGuide
  const kicker = [kind, ...(page.tags ?? [])].map(escapeHtml).join(' · ')
  const table = page.table ? tableBlock(page.table) : ''
  const sections = page.sections.map(sectionBlock).join('')
  const body = `<div class="guide-body">${sections}${faqBlock(page)}${sourcesBlock(page)}</div>`
  const main = `<article class="editorial guide wrap">${topRow}<p class="overline">${kicker}</p><h1>${escapeHtml(page.h1)}</h1>${shortAnswerBlock(page)}${datesLine(page)}${table}${body}${relatedBlock(content, page)}</article>`
  const cta = page.lang === 'en' ? businessCta() : ''
  const active = compare ? 'compare' : 'guides'
  return `${meta}${header(active, page.lang)}<main id="main" tabindex="-1">${main}${cta}</main>${footer(page.lang)}`
}

const groupSection = (group) => {
  const intro = group.intro ? `<p>${escapeHtml(group.intro)}</p>` : ''
  return `<section class="guide-section guide-faq" id="${group.id}"><h2>${escapeHtml(group.heading)}</h2>${intro}${detailsList(group.items)}</section>`
}
const groupLink = (group) => `<a class="text-link" href="#${group.id}">${escapeHtml(group.heading)}</a>`
const groupNav = (groups, label) => {
  if (groups.length < 2) return ''
  return `<nav class="faq-groups" aria-label="${label}">${groups.map(groupLink).join('')}</nav>`
}

export function renderFaq(ctx, page) {
  const { head, header, footer, businessCta, origin } = ctx
  const text = copy[page.lang]
  const url = `${origin}/${page.route}`
  const items = page.groups.flatMap((group) => group.items)
  const faq = {
    ...faqNode(page, url, items),
    name: page.h1,
    description: page.description,
    datePublished: page.datePublished,
    dateModified: page.dateModified,
    publisher: organization(origin),
  }
  const trail = [
    ['Ritoko', ''],
    [page.h1, page.route],
  ]
  const structured = [faq, breadcrumbNode(origin, url, trail)]
  const options = { lang: page.lang, alternates: alternateLinks(origin, page) }
  const title = escapeHtml(page.metaTitle)
  const description = escapeHtml(page.description)
  const meta = head(title, description, page.route, structured, false, options)

  const topRow = `<div class="page-meta"><a class="text-link" href="/">← Ritoko</a>${languageSwitch(page)}</div>`
  const answer = page.shortAnswer ? shortAnswerBlock(page) : ''
  const sections = page.groups.map(groupSection).join('')
  const body = `<div class="guide-body">${sections}</div>`
  const main = `<article class="editorial guide wrap">${topRow}<p class="overline">FAQ</p><h1>${escapeHtml(page.h1)}</h1>${answer}${datesLine(page)}${groupNav(page.groups, text.groups)}${body}</article>`
  const cta = page.lang === 'en' ? businessCta() : ''
  return `${meta}${header('faq', page.lang)}<main id="main" tabindex="-1">${main}${cta}</main>${footer(page.lang)}`
}

const faqLink = (faq, text, arrow) => {
  if (!faq) return ''
  return `<p class="index-link"><a class="text-link" href="/${faq.route}">${text.allQuestions} ${arrow}</a></p>`
}

export function renderIndex(ctx, entry) {
  const { head, header, footer, businessCta, origin, content, arrow } = ctx
  const text = copy[entry.lang]
  const words = indexCopy[entry.collection][entry.lang]
  const url = `${origin}/${entry.route}`
  const name = entry.collection === 'compare' ? text.navCompare : text.navGuides
  const collection = {
    '@type': 'CollectionPage',
    name: words.h1,
    description: words.description,
    url,
    inLanguage: entry.lang,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: entry.items.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${origin}/${item.route}`,
        name: item.h1,
      })),
    },
  }
  const trail = [
    ['Ritoko', ''],
    [name, entry.route],
  ]
  const structured = [collection, breadcrumbNode(origin, url, trail)]
  const options = { lang: entry.lang, alternates: alternateLinks(origin, entry) }
  const title = escapeHtml(words.title)
  const description = escapeHtml(words.description)
  const meta = head(title, description, entry.route, structured, false, options)

  const topRow = `<div class="page-meta"><a class="text-link" href="/">← Ritoko</a>${languageSwitch(entry)}</div>`
  const cards = entry.items.map((item) => card(item, 2)).join('')
  const answers = entry.collection === 'guides' ? faqLink(content.faq[entry.lang], text, arrow) : ''
  const intro = `<p class="overline">${name}</p><h1>${escapeHtml(words.h1)}</h1><p class="editorial-lede">${escapeHtml(words.lede)}</p>`
  const main = `<section class="editorial guide-index wrap">${topRow}${intro}<div class="problem-grid">${cards}</div>${answers}</section>`
  const cta = entry.lang === 'en' ? businessCta() : ''
  return `${meta}${header(entry.collection, entry.lang)}<main id="main" tabindex="-1">${main}${cta}</main>${footer(entry.lang)}`
}

// The home page section that lists the problems the guides answer. Empty until a guide exists.
export function homeProblems({ content, arrow }) {
  const items = content.guides.en.slice(0, homeLimit)
  if (items.length === 0) return ''
  const cards = items.map((item) => card(item, 3)).join('')
  const all = `<a class="text-link" href="/${content.index.guides.en.route}">All guides ${arrow}</a>`
  return `\n\n<section class="section problems-section" id="problems"><div class="wrap"><div class="section-intro section-intro-row"><div><p class="overline">SHORT ANSWERS TO REAL PROBLEMS</p><h2>Problems we are <br><em>built for.</em></h2></div>${all}</div><div class="problem-grid">${cards}</div></div></section>`
}

// The extra links for the header and footer. A link exists only when the page it points to is built.
export function navLinks(content, lang) {
  const other = lang === 'en' ? 'fr' : 'en'
  const guides = content.index.guides[lang] ?? content.index.guides.en
  const faq = content.faq[lang] ?? content.faq.en
  const home = lang === 'fr' ? { route: '' } : null
  const target = content.index.guides[other] ?? content.faq[other] ?? home
  return {
    guides: guides ? `/${guides.route}` : null,
    compare: content.index.compare ? `/${content.index.compare.route}` : null,
    faq: faq ? `/${faq.route}` : null,
    language: target ? { href: `/${target.route}`, lang: other, label: copy[other].language } : null,
  }
}

const sitemapNamespace = 'http://www.sitemaps.org/schemas/sitemap/0.9'
const xhtmlNamespace = 'http://www.w3.org/1999/xhtml'
export function sitemapXml(origin, pages) {
  const alternate = ({ hreflang, route }) =>
    `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${origin}/${route}"/>`
  const url = ({ route, lastmod, alternates = [] }) =>
    `<url><loc>${origin}/${route}</loc><lastmod>${lastmod}</lastmod>${alternates.map(alternate).join('')}</url>`
  const urls = pages.map(url).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${sitemapNamespace}" xmlns:xhtml="${xhtmlNamespace}">${urls}</urlset>\n`
}

// llms.txt and llms-full.txt are optional hygiene: no AI crawler is documented to rely on them, so nothing on
// the site depends on them. They restate what the pages say, plus the limits, and list only pages that exist.
const llmsIntro = [
  '# Ritoko',
  '',
  '> Ritoko is an open-source (MIT) local MCP server, Claude Code and Codex plugin, and command-line tool. Your agent solves a browser, HTTP API or MCP task once; Ritoko saves it as a JSON workflow and replays it on the rows of a CSV or Excel file, keeping a journal for each item.',
  '',
  'Scope, stated plainly:',
  '',
  '- Replaying saved deterministic steps with the direct runner makes no model call. The first run, repairs, reading new documents and any MCP tool that itself calls a model still use one. In host mode your agent’s own tools do the work.',
  '- Every item has an outcome in a local SQLite journal. A write whose outcome is uncertain is held for review, not resubmitted automatically.',
  '- The journal only covers actions run through this installation and cannot see submissions made elsewhere. Ritoko does not promise “no duplicates”: that needs a correct business key, commit step and result check in the workflow.',
  '- No built-in OCR, and no CAPTCHA or anti-bot bypass. Requires Node.js 24 or newer, and Google Chrome for browser workflows with the direct runner.',
  '',
]
const llmsDocs = [
  '## Documentation',
  '',
  '- [README](https://github.com/Swih/ritoko#readme): install, how it works, evidence and current scope',
  '- [Advanced usage](https://github.com/Swih/ritoko/blob/main/docs/usage.md): client setup, CLI, browser choice, host mode and recovery',
  '- [Agent skill](https://github.com/Swih/ritoko/blob/main/skills/ritoko/SKILL.md): the instructions the plugin gives the agent',
  '- [Source code and issues](https://github.com/Swih/ritoko): bug reports and feature requests',
  '',
]
const llmsSite = (origin) => [
  '## On this site',
  '',
  `- [Use cases](${origin}/use-cases): six use cases: one measured run, one recorded run and four described patterns`,
  `- [Watch a real run](${origin}/watch): a real-time recording of an interrupted batch, resumed and run again`,
  `- [Measurements](${origin}/benchmarks): the RPA Challenge timings and the crash-and-resume test, with their boundaries`,
  '',
  '## License',
  '',
  '- [MIT license](https://github.com/Swih/ritoko/blob/main/LICENSE)',
  '',
]

const pageLine = (origin, page) =>
  `- [${page.h1}](${origin}/${page.route}): ${page.shortAnswer ?? page.description}`
const listSection = (origin, heading, pages) => {
  if (pages.length === 0) return []
  return [`## ${heading}`, '', ...pages.map((page) => pageLine(origin, page)), '']
}
const listsFor = (origin, content, lang) => {
  if (lang === 'fr') {
    return listSection(origin, 'Français', [...content.guides.fr, ...faqOf(content, 'fr')])
  }
  return [
    ...listSection(origin, 'Guides', content.guides.en),
    ...listSection(origin, 'Compare', content.comparisons),
    ...listSection(origin, 'FAQ', faqOf(content, 'en')),
  ]
}

export function llmsTxt(origin, content) {
  const lists = [...listsFor(origin, content, 'en'), ...listsFor(origin, content, 'fr')]
  return [...llmsIntro, ...lists, ...llmsDocs, ...llmsSite(origin)].join('\n')
}

const fullEntry = (origin, page) => {
  const lines = [`### ${page.h1}`, '', `URL: ${origin}/${page.route}`]
  lines.push(`Updated: ${page.dateModified}`, '')
  if (page.shortAnswer) lines.push(`Short answer: ${page.shortAnswer}`, '')
  for (const group of page.groups ?? [{ items: page.faq ?? [] }]) {
    if (group.heading) lines.push(`#### ${group.heading}`, '')
    for (const { q, a } of group.items) lines.push(`Q: ${q}`, `A: ${plainText(a)}`, '')
  }
  return lines
}
const fullSection = (origin, heading, pages) => {
  if (pages.length === 0) return []
  return [`## ${heading}`, '', ...pages.flatMap((page) => fullEntry(origin, page))]
}

export function llmsFullTxt(origin, content) {
  const english = [
    ...fullSection(origin, 'Guides', content.guides.en),
    ...fullSection(origin, 'Compare', content.comparisons),
    ...fullSection(origin, 'FAQ', faqOf(content, 'en')),
  ]
  const french = fullSection(origin, 'Français', [...content.guides.fr, ...faqOf(content, 'fr')])
  return [...llmsIntro, ...english, ...french, ...llmsDocs, ...llmsSite(origin)].join('\n')
}
