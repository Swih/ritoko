// The contract for every page data module in this folder. Nothing here runs: these typedefs document the
// shapes that collect.mjs validates and render.mjs renders. `node scripts/site/build.mjs` lists every problem
// it finds in one go, so fix them all and run it again.
//
// Plain text fields are written as-is: no html and no entities (write & and ’, not &amp; and &rsquo;). The
// templates escape them. Fields marked "inline html" accept only <a href>, <strong>, <em>, <code> and <br>.
// Fields marked "block html" accept the tags listed on Section.html. Every tag must be closed.
//
// Files and export names:
//   problems.mjs           problemPages    Page[]          English guides, /guides/<slug>
//   comparisons.mjs        comparisonPages Page[]          English comparisons, /compare/<slug>
//   faq.mjs                faqGroups       FaqGroup[]      English /faq, page-level fields in faqPage
//   fr/problems.mjs        problemPagesFr  Page[]          French guides, /fr/guides/<slug>
//   fr/faq.mjs             faqGroupsFr     FaqGroup[]      French /fr/faq, page-level fields in faqPageFr
// An empty collection builds nothing and nothing links to it. _sample.mjs is loaded only when SITE_SAMPLES=1.

/**
 * A source cited on the page. Every fact that comes from outside Ritoko needs one.
 * @typedef {object} Source
 * @property {string} label      Plain text link label, for example "Playwright docs: Locators".
 * @property {string} url        Absolute https URL of a page you opened.
 * @property {string} retrieved  ISO date (YYYY-MM-DD) on which you opened it.
 */

/**
 * One question and its answer. The page shows it in a <details> and, with the same text, in FAQPage JSON-LD.
 * @typedef {object} FaqItem
 * @property {string} q  Plain text question, written the way people type it.
 * @property {string} a  Inline html answer, rendered inside one <p>. Keep it to a few sentences.
 */

/**
 * A section of the page body, rendered as <section id><h2>heading</h2>html</section>.
 * @typedef {object} Section
 * @property {string} id       kebab-case anchor, unique on the page. Not "faq", "sources", "related" or
 *                             "short-answer".
 * @property {string} heading  Plain text H2. A question where that reads naturally.
 * @property {string} html     Block html: p, ul, ol, li, h3, h4, pre (with code), blockquote, table, img (with
 *                             alt, width and height), a, strong, em, code, br. No h1, h2, script, style,
 *                             iframe, form, section or article. An id attribute must not repeat another id
 *                             on the page.
 */

/**
 * A comparison table. It renders as a real <table> with a <caption>, column headers and, by default, row
 * headers, inside a scrollable region so it never widens the page.
 * @typedef {object} Table
 * @property {string} caption         Plain text. Becomes the <caption> and the accessible name of the region.
 * @property {string[]} columns       Plain text column headers.
 * @property {string[][]} rows        One array per row, one cell per column. A cell is inline html.
 * @property {boolean} [rowHeaders]   Default true: the first cell of every row is a <th scope="row">.
 * @property {string} [note]          Plain text small print below the table, for example when it was checked.
 */

/**
 * A guide (problemPages / problemPagesFr) or a comparison (comparisonPages). Unknown keys are rejected.
 * Preflight enforces the limits in brackets on the built page.
 * @typedef {object} Page
 * @property {string} slug           kebab-case. Unique per language across guides and comparisons.
 * @property {'en'|'fr'} lang        Must match the module: English modules use 'en', fr/ modules use 'fr'.
 * @property {string} metaTitle      Plain text <title> and social title [unique, at most 65 characters].
 * @property {string} description    Plain text meta description [unique, 70 to 160 characters].
 * @property {string} h1             Plain text H1. A real question when possible.
 * @property {string} shortAnswer    Plain text, one or two sentences that answer the H1 directly. Shown in a
 *                                   "Short answer" block under the H1, on the index and home cards, and in
 *                                   llms-full.txt [at most 80 words].
 * @property {Section[]} sections    At least one. Rendered in order.
 * @property {FaqItem[]} [faq]       Shown at the end and as FAQPage JSON-LD, only for the items listed here.
 * @property {Table} [table]         Rendered between the short answer and the first section.
 * @property {string[]} [related]    Slugs of other pages in the same language (guides, then comparisons). Shown
 *                                   as a "Related" block at the end, in this order.
 * @property {Source[]} [sources]    Cited sources. Required, at least one, for a comparison.
 * @property {string} datePublished  ISO date (YYYY-MM-DD). Shown on the page and used in Article JSON-LD.
 * @property {string} dateModified   ISO date, not before datePublished. Shown on the page, used in Article
 *                                   JSON-LD and as <lastmod> in sitemap.xml. Change it when the content changes.
 * @property {string[]} [tags]       Plain text labels shown above the H1 and used as Article keywords.
 * @property {string} [twin]         kebab-case key shared by an English page and its French translation. Two
 *                                   pages with the same twin key get reciprocal hreflang links, a language
 *                                   switch link and mirrored sitemap alternates. Comparisons are English only.
 */

/**
 * A group of questions on the FAQ page.
 * @typedef {object} FaqGroup
 * @property {string} id        kebab-case anchor, unique on the page.
 * @property {string} heading   Plain text H2.
 * @property {string} [intro]   Plain text sentence under the heading.
 * @property {FaqItem[]} items  At least one. Every item on the page goes into one FAQPage JSON-LD.
 */

/**
 * The fields of the FAQ page itself, exported as faqPage / faqPageFr next to the groups. Required when there
 * is at least one group.
 * @typedef {object} FaqPage
 * @property {string} metaTitle      As Page.metaTitle.
 * @property {string} description    As Page.description.
 * @property {string} h1             As Page.h1.
 * @property {string} [shortAnswer]  As Page.shortAnswer. Optional here.
 * @property {string} datePublished  As Page.datePublished.
 * @property {string} dateModified   As Page.dateModified.
 */

export {}
