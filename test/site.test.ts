import { describe, expect, it } from 'vitest'

// The site generator is plain ESM beside the static site, outside tsc's include, so it is loaded at run time.
const generator = (file: string) => import(new URL(`../scripts/site/${file}`, import.meta.url).href)
const { loadPages } = await generator('pages/collect.mjs')
const render = await generator('render.mjs')

const origin = 'https://ritoko.com'
const bySlug = (slug: string) => (page: { slug: string }) => page.slug === slug
const empty = {
  guides: { en: [], fr: [] },
  comparisons: [],
  faq: { en: null, fr: null },
  index: { guides: { en: null, fr: null }, compare: null },
  entries: [],
}

type Question = { name: string; acceptedAnswer: { text: string } }
type GraphNode = { '@type': string; mainEntity?: Question[] }

/** Stubs the shared page chrome and records what the templates pass to head and header. */
function chrome(content: unknown) {
  const calls: { head: unknown[][]; header: unknown[][] } = { head: [], header: [] }
  const ctx = {
    head: (...args: unknown[]) => {
      calls.head.push(args)
      return '<head></head>'
    },
    header: (...args: unknown[]) => {
      calls.header.push(args)
      return '<header></header>'
    },
    footer: () => '<footer></footer>',
    businessCta: () => '',
    origin,
    arrow: '>',
    content,
  }
  return { ctx, calls }
}

describe('site pages', () => {
  it('links an English page and its French twin with reciprocal alternates', async () => {
    const content = await loadPages({ samples: true })
    const en = content.guides.en.find(bySlug('ritoko-sample-problem'))
    const fr = content.guides.fr.find(bySlug('ritoko-sample-probleme'))
    const guide = [
      { hreflang: 'en', route: 'guides/ritoko-sample-problem' },
      { hreflang: 'fr', route: 'fr/guides/ritoko-sample-probleme' },
      { hreflang: 'x-default', route: 'guides/ritoko-sample-problem' },
    ]
    expect(en.alternates).toEqual(guide)
    expect(fr.alternates).toEqual(guide)
    const faq = [
      { hreflang: 'en', route: 'faq' },
      { hreflang: 'fr', route: 'fr/faq' },
      { hreflang: 'x-default', route: 'faq' },
    ]
    expect(content.faq.en.alternates).toEqual(faq)
    expect(content.faq.fr.alternates).toEqual(faq)
  })

  it('writes a lastmod and mirrored alternates for every sitemap entry', async () => {
    const content = await loadPages({ samples: true })
    const pages = [{ route: '', lastmod: '2026-10-04' }, ...content.entries]
    const xml: string = render.sitemapXml(origin, pages)
    const urls: string[] = xml.match(/<url>.*?<\/url>/g) ?? []
    expect(urls).toHaveLength(pages.length)
    for (const url of urls) expect(url).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
    const loc = '<loc>https://ritoko.com/guides/ritoko-sample-problem<'
    const guide = urls.find((url) => url.includes(loc))
    expect(guide?.match(/<xhtml:link /g)).toHaveLength(3)
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
  })

  it('shows the same questions and answers in the page and in the FAQPage JSON-LD', async () => {
    const content = await loadPages({ samples: true })
    const { ctx, calls } = chrome(content)
    const page = content.guides.en.find(bySlug('ritoko-sample-problem'))
    const html: string = render.renderGuide(ctx, page)
    const structured = calls.head[0]?.[3] as GraphNode[]
    const marked = structured.find((node) => node['@type'] === 'FAQPage')?.mainEntity ?? []
    const visible = [...html.matchAll(/<summary>(.*?)<span [^>]*>.*?<\/span><\/summary><p>(.*?)<\/p>/g)]
    expect(visible.length).toBeGreaterThan(0)
    const listed = marked.map((item) => [item.name, item.acceptedAnswer.text])
    const shown = visible.map((match) => [match[1], (match[2] ?? '').replace(/<[^>]*>/g, '')])
    expect(listed).toEqual(shown)
  })

  it('renders one H1 and one short answer block between the H1 and the first section', async () => {
    const content = await loadPages({ samples: true })
    const { ctx } = chrome(content)
    const page = content.guides.en.find(bySlug('ritoko-sample-problem'))
    const html: string = render.renderGuide(ctx, page)
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(html.match(/class="short-answer"/g)).toHaveLength(1)
    expect(html.indexOf('class="short-answer"')).toBeGreaterThan(html.indexOf('<h1'))
    expect(html.indexOf('class="short-answer"')).toBeLessThan(html.indexOf('id="why"'))
    const ids = ['why', 'code', 'steps', 'faq', 'sources', 'related']
    for (const id of ids) expect(html).toContain(`id="${id}"`)
    expect(html).toContain('<pre tabindex="0">')
  })

  it('gives a French page its language, alternates and a link to its English twin', async () => {
    const content = await loadPages({ samples: true })
    const { ctx, calls } = chrome(content)
    const page = content.guides.fr.find(bySlug('ritoko-sample-probleme'))
    const html: string = render.renderGuide(ctx, page)
    const options = calls.head[0]?.[5] as { lang: string; alternates: { href: string }[] }
    const hrefs = options.alternates.map((alternate) => alternate.href)
    expect(options.lang).toBe('fr')
    expect(hrefs).toContain(`${origin}/guides/ritoko-sample-problem`)
    expect(html).toContain('hreflang="en" lang="en">Read this page in English</a>')
    expect(html).toContain('Réponse courte')
    expect(calls.header[0]).toEqual(['guides', 'fr'])
  })

  it('renders a comparison table with a caption, column headers and row headers', async () => {
    const content = await loadPages({ samples: true })
    const { ctx } = chrome(content)
    const page = content.comparisons.find(bySlug('ritoko-sample-comparison'))
    const html: string = render.renderGuide(ctx, page)
    expect(html).toContain('<caption>Sample table: what each tool documents (not real data)</caption>')
    expect(html).toContain('<th scope="col">Tool A (sample)</th>')
    expect(html).toContain('<th scope="row">Runs where?</th>')
    expect(html).toContain('role="region"')
  })

  it('lists only the pages that exist in the llms files', async () => {
    expect(render.llmsTxt(origin, empty)).not.toContain('## Guides')
    expect(render.llmsTxt(origin, empty)).toContain('## Documentation')
    const content = await loadPages({ samples: true })
    expect(render.llmsTxt(origin, content)).toContain(`${origin}/guides/ritoko-sample-problem`)
    expect(render.llmsFullTxt(origin, content)).toContain('Q: Is this sample real content?')
  })

  it('adds navigation and home links only for collections that have pages', async () => {
    const none = { guides: null, compare: null, faq: null, language: null }
    expect(render.navLinks(empty, 'en')).toEqual(none)
    expect(render.homeProblems({ content: empty, arrow: '' })).toBe('')
    const content = await loadPages({ samples: true })
    const nav = render.navLinks(content, 'en')
    expect(nav).toMatchObject({ guides: '/guides', compare: '/compare', faq: '/faq' })
    expect(nav.language.href).toBe('/fr/guides')
    expect(render.navLinks(content, 'fr').language.href).toBe('/guides')
    const home: string = render.homeProblems({ content, arrow: '' })
    expect(home).toContain('id="problems"')
    expect((home.match(/class="problem-card"/g) ?? []).length).toBeLessThanOrEqual(6)
  })

  it('formats dates and text without depending on ICU data', () => {
    expect(render.formatDate('2026-10-01', 'fr')).toBe('1er octobre 2026')
    expect(render.formatDate('2026-10-05', 'en')).toBe('5 October 2026')
    const markup = 'A <a href="/x">link</a> &amp; <code>code</code><br>next\n line'
    expect(render.plainText(markup)).toBe('A link & code next line')
    expect(render.escapeHtml('a & "b" <c>')).toBe('a &amp; &quot;b&quot; &lt;c&gt;')
  })
})
