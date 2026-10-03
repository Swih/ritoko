import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cases } from '../../site/cases.js'
import { benchmarks } from './benchmarks.mjs'
import { casePages } from './content.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const site = resolve(root, 'site')
const geometry = JSON.parse(readFileSync(resolve(root, 'design/brand/ritoko/geometry.json'), 'utf8'))
const pieces = geometry.path.match(/M[^M]+/g).reverse()
const mark = (cls = '', label = '') =>
  `<svg class="mark ${cls}" viewBox="0 0 1024 1024" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${pieces.map((d, i) => `<path class="mark-stroke stroke-${i}" d="${d}"/>`).join('')}</svg>`
const arrow = '<span aria-hidden="true">↗</span>'
const theme =
  '<button class="theme-toggle" type="button" aria-label="Switch to cream theme"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18V3Z"/><circle cx="12" cy="12" r="9"/></svg></button>'
const brand = `<a class="brand" href="/" aria-label="Ritoko home">${mark()}<span>Ritoko</span></a>`
const origin = 'https://ritoko.com'
const email = 'dayan.decamp.pro@gmail.com'
const jsonLd = (value) =>
  `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`
const organization = {
  '@type': 'Organization',
  '@id': `${origin}/#organization`,
  name: 'Ritoko',
  url: origin,
  logo: `${origin}/assets/brand/ritoko.png`,
  email,
  sameAs: ['https://github.com/Swih/ritoko'],
}
const head = (title, description, route = '', structured = [], noindex = false) => `<!doctype html>
<html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${route === 'contact' ? '<meta name="referrer" content="no-referrer">' : ''}
<title>${title}</title><meta name="description" content="${description}">
<link rel="canonical" href="https://ritoko.com/${route}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-video-preview:-1'}">
<meta name="color-scheme" content="dark light"><meta name="theme-color" content="#14130f">
<link rel="icon" href="/favicon.ico" sizes="16x16 24x24 32x32 48x48 64x64 128x128 256x256">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" sizes="any"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Ritoko"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="https://ritoko.com/${route}"><meta property="og:image" content="https://ritoko.com/assets/og-cadence.png"><meta name="twitter:card" content="summary_large_image">
<meta property="og:locale" content="en_US"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Ritoko: a saved workflow and a journal of checked results"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${origin}/assets/og-cadence.png">
${jsonLd({ '@context': 'https://schema.org', '@graph': [organization, ...structured] })}
<script>try{var t=localStorage.getItem('ritoko-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}document.querySelector('meta[name="theme-color"]').content=document.documentElement.dataset.theme==='light'?'#f4f0e6':'#14130f';</script>
<link rel="preload" href="/assets/fonts/fraunces-normal-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/assets/fonts/manrope-normal-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/fonts/fonts.css"><link rel="stylesheet" href="/styles.css"><script type="module" src="/main.js"></script>
</head><body><a class="skip-link" href="#main">Skip to content</a>`
const header = (active = 'home') =>
  `<header class="site-header"><div class="wrap header-row">${brand}<nav class="site-nav" aria-label="Primary"><button class="nav-toggle" type="button" aria-controls="nav-list" aria-expanded="false">Menu <span aria-hidden="true">＋</span></button><ul id="nav-list"><li><a href="/#process">The process</a></li><li><a href="/use-cases" ${active === 'cases' ? 'aria-current="page"' : ''}>Use cases <span class="nav-count">06</span></a></li><li><a href="/contact" ${active === 'contact' ? 'aria-current="page"' : ''}>For businesses</a></li><li><a href="https://github.com/Swih/ritoko">GitHub ${arrow}</a></li></ul></nav><div class="header-actions">${theme}<a class="button button-small" href="/#install">Install ${arrow}</a></div></div></header>`
const footer = () =>
  `<footer class="site-footer"><div class="wrap"><div class="footer-top"><p>One good run. <br>Every next row.</p><a class="text-link" href="https://github.com/Swih/ritoko">Make it yours ${arrow}</a></div><div class="footer-wordmark" aria-hidden="true">Ritoko${mark()}</div><div class="footer-bottom"><span>Local workflows. Lasting memory.</span><a href="/contact">A workflow to automate? ${arrow}</a><a href="/benchmarks">Measurements</a><a href="https://github.com/Swih/ritoko/blob/main/LICENSE">Open source · MIT</a><a href="/privacy">Privacy</a><span>© 2026 Swih</span></div></div></footer></body></html>`
const rows = () =>
  Array.from(
    { length: 10 },
    (_, i) =>
      `<tr data-row="${i}"><td class="row-key">${String(i + 1).padStart(2, '0')}</td><td>${['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'K. Johnson', 'M. Hamilton', 'Linus Torvalds', 'Barbara Liskov', 'E. Dijkstra', 'Donald Knuth', 'Radia Perlman'][i]}</td><td><span class="state" data-row-state>pending</span></td></tr>`,
  ).join('')
const journal = () =>
  `<aside class="demo-journal"><div class="pane-label"><span>ITEM JOURNAL</span><span class="mono">SQLite</span></div><p class="journal-summary" data-journal-summary>10 pending</p><table><caption class="sr-only">Sample customer batch and item states</caption><thead><tr><th scope="col">Key</th><th scope="col">Customer</th><th scope="col">State</th></tr></thead><tbody>${rows()}</tbody></table><p class="journal-note" data-journal-note>Every row keeps its own outcome.</p></aside>`
const form = (rpa = false) =>
  `<div class="demo-browser"><div class="browser-bar"><span class="browser-dots" aria-hidden="true">● ● ●</span><span>${rpa ? 'rpachallenge.com · reconstructed view' : 'Back office · sample data'}</span><span aria-hidden="true">↗</span></div><div class="browser-body"><div class="form-heading"><span class="overline">${rpa ? 'INPUT FORMS' : 'CUSTOMER RECORD'}</span><span class="form-row mono" data-current-row>ROW 01 / 10</span></div><h3 data-form-title>${rpa ? 'A different form. Every row.' : 'A new customer.'}</h3><div class="demo-fields ${rpa ? 'rpa-fields' : ''}" data-fields>${(rpa ? ['First Name', 'Last Name', 'Company Name', 'Role in Company', 'Address', 'Email', 'Phone Number'] : ['Name', 'Company', 'Email']).map((name, i) => `<div class="demo-field" data-field="${i}"><span>${name}</span><span class="field-value" data-value>—</span><span class="field-target" aria-hidden="true">${i + 1}</span></div>`).join('')}</div><div class="submit-row"><span class="commit-label">commit boundary</span><div class="demo-submit" data-submit>Submit <span aria-hidden="true">↗</span></div></div><div class="receipt" data-receipt><span class="receipt-dot"></span><span data-receipt-text>Waiting for the result check</span></div></div></div>`
const controls = () =>
  `<div class="demo-controls"><button class="play-control" type="button" data-play><span aria-hidden="true">▶</span> Play sequence</button><button class="text-control" type="button" data-reset>Reset</button><span class="demo-progress"><span data-progress></span></span><span class="mono demo-time" data-time>00:00</span></div><p class="demo-caption" data-caption role="status">Interactive illustration. Sample data; no live submissions.</p>`
const demo = (rpa = false) =>
  `<div class="run-demo ${rpa ? 'run-demo-rpa' : ''}" data-run-demo data-kind="${rpa ? 'rpa' : 'customer'}"><div class="run-bar"><span><i class="status-dot"></i><span data-run-label>Ready to replay</span></span><span class="mono">${rpa ? 'challenge.xlsx' : 'customers.csv'} → 10 rows</span></div>${controls()}<div class="run-surface">${form(rpa)}${journal()}</div></div>`
const installer = `<div class="installer" data-tabs><div class="agent-tabs" role="tablist" aria-label="Choose your agent"><button type="button" role="tab" id="agent-claude" aria-controls="install-claude" aria-selected="true">Claude Code</button><button type="button" role="tab" id="agent-codex" aria-controls="install-codex" aria-selected="false" tabindex="-1">Codex CLI</button></div>${[
  ['claude', 'claude plugin marketplace add Swih/ritoko', 'claude plugin install ritoko@ritoko'],
  ['codex', 'codex plugin marketplace add Swih/ritoko', 'codex plugin add ritoko@ritoko'],
]
  .map(
    ([agent, one, two]) =>
      `<div role="tabpanel" id="install-${agent}" aria-labelledby="agent-${agent}" ${agent === 'codex' ? 'hidden' : ''}><div class="cmd"><span aria-hidden="true">$</span><code>${one}</code><button type="button" data-copy>Copy</button></div><div class="cmd"><span aria-hidden="true">$</span><code>${two}</code><button type="button" data-copy>Copy</button></div></div>`,
  )
  .join(
    '',
  )}<p class="small">Restart your client. Node 24+ required. Google Chrome for browser workflows.</p></div>`
const install = () =>
  `<section class="section install-section" id="install"><div class="wrap install-layout"><div><p class="overline">READY WHEN YOU ARE</p><h2>Your next task <br>could be the <em>last first time.</em></h2><p>Install the plugin. Ask your agent to record a task. Keep the procedure.</p><a class="text-link" href="https://github.com/Swih/ritoko#install">Read the setup guide ${arrow}</a></div><div>${installer}<p class="agent-request">“Record this task with Ritoko.”</p></div></div></section>`
const recording = () =>
  `<figure class="recording" data-recording><video controls playsinline preload="metadata" poster="/assets/media/poster.png" width="1280" height="720" aria-label="Actual Ritoko customer batch, interruption, resume and rerun"><source src="/assets/media/demo.webm" type="video/webm"><source src="/assets/media/demo.mp4" type="video/mp4"></video><figcaption><span>ACTUAL RECORDING</span>34.2 seconds · real time · no speed-up</figcaption><div class="video-chapters" aria-label="Recording chapters"><button type="button" data-seek="0">00:00 · Start</button><button type="button" data-seek="10">00:10 · Interruption</button><button type="button" data-seek="18">00:18 · Resume</button><button type="button" data-seek="27">00:27 · Rerun</button></div></figure>`
const businessCta = () =>
  `<section class="section business-cta"><div class="wrap"><div><p class="overline">FOR YOUR TEAM</p><h2>Which routine <br>would you <em>hand over?</em></h2><p>Tell us what you repeat, which tools you use and what a successful result looks like. We can discuss whether the workflow is a fit for Ritoko.</p></div><a class="button" href="/contact">Tell us about your workflow ${arrow}</a></div></section>`
const breadcrumb = (name, route) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Ritoko', item: `${origin}/` },
    ...(route.startsWith('use-cases/')
      ? [{ '@type': 'ListItem', position: 2, name: 'Use cases', item: `${origin}/use-cases` }]
      : []),
    {
      '@type': 'ListItem',
      position: route.startsWith('use-cases/') ? 3 : 2,
      name,
      item: `${origin}/${route}`,
    },
  ],
})
const videoSchema = {
  '@type': 'VideoObject',
  name: 'Ritoko: interrupt a customer batch, resume and rerun',
  description:
    'An actual local back-office recording: the process is killed at row five, resumed from its item journal and run again. Ten unique submissions, nine verified items and one held for review. A deliberate 700 ms submission delay makes the interruption observable.',
  thumbnailUrl: [`${origin}/assets/media/poster.png`],
  uploadDate: '2026-10-03T02:11:38.055Z',
  duration: 'PT34.2S',
  contentUrl: `${origin}/assets/media/demo.mp4`,
  creator: { '@id': `${origin}/#organization` },
}

const snapshot = resolve(root, 'design/site-before-2026-10-03')
if (!existsSync(snapshot)) {
  mkdirSync(snapshot, { recursive: true })
  for (const name of ['index.html', 'styles.css', 'main.js', '404.html'])
    copyFileSync(resolve(site, name), resolve(snapshot, name))
}

// The static pages share authored markup; no framework or build step is needed to serve them.
const home = `${head(
  'Ritoko — Repeatable workflow automation for your AI agent',
  'A local plugin for Claude Code and Codex that turns a task your agent did once into a checked, resumable workflow, with a per-item journal.',
  '',
  [
    {
      '@type': 'SoftwareApplication',
      '@id': `${origin}/#software`,
      name: 'Ritoko',
      url: origin,
      applicationCategory: 'DeveloperApplication',
      softwareRequirements: 'Node.js 24+. Google Chrome for browser workflows.',
      license: 'https://github.com/Swih/ritoko/blob/main/LICENSE',
      description:
        'Save a task as a parameterized workflow. Replay deterministic steps without a model, check each result and resume from the item journal.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    { '@type': 'WebSite', '@id': `${origin}/#website`, name: 'Ritoko', url: origin, inLanguage: 'en' },
  ],
)}
${header()}
<main id="main" tabindex="-1">
<section class="hero wrap" id="top">
  <div class="hero-copy"><p class="overline"><span class="tiny-mark"></span> A LOCAL PLUGIN FOR CLAUDE CODE &amp; CODEX</p><h1>Teach it once. <br>Run every row. <br><em>Remember.</em></h1><p class="hero-lede">Stop copying a spreadsheet into the same forms. <br>Your agent learns one example. Ritoko repeats the saved steps for each new row, checks the result and remembers where to resume.</p><div class="hero-actions"><a class="button" href="#process">See how it works <span aria-hidden="true">↓</span></a><a class="text-link" href="/watch">Watch a real run ${arrow}</a></div><p class="hero-compat">Free <span>·</span> Open source <span>·</span> MIT license</p><a class="hero-business" href="/contact">Have a workflow to automate? Tell us about it ${arrow}</a></div>
  <div class="hero-visual" data-hero-story aria-label="Automatic example: a CSV becomes three checked customer records">
    <div class="hero-note"><span class="mono" data-hero-phase>01 / YOUR AGENT LEARNS</span><span data-hero-note>One example customer. One task to learn.</span><button class="hero-pause" type="button" data-loop-toggle aria-label="Pause header example">Ⅱ Pause</button></div>
    <div class="source-sheet"><div class="sheet-title"><span aria-hidden="true">▤</span> customers.csv <span>3 new rows</span></div><div class="sheet-grid"><span>NAME</span><span>COMPANY</span><span data-source-row="0">Ada Lovelace</span><span data-source-row="0">Analytical Engines</span><span data-source-row="1">Grace Hopper</span><span data-source-row="1">Compiler Works</span><span data-source-row="2">Alan Turing</span><span data-source-row="2">Bletchley Logic</span></div><div class="sheet-rule"></div><p>Three rows. <br>Three new customers.</p></div>
    <div class="saved-sheet"><div class="saved-top"><span class="overline" data-hero-task>LEARN ONE EXAMPLE</span>${mark('hero-mark')}</div><h2>customer <br>onboarding</h2><p class="saved-description" data-hero-description>Your agent finds the fields once.</p><div class="hero-fields">${['Name', 'Company', 'Email'].map((label, i) => `<div class="hero-field" data-hero-field="${i}"><span>${label}</span><strong data-hero-value>—</strong></div>`).join('')}</div><div class="hero-submit" data-hero-submit><span data-hero-receipt>Find the fields → fill → submit → check</span><span aria-hidden="true">↗</span></div><div class="saved-bottom"><span class="status-dot"></span><span data-hero-model>First example: with your agent</span></div></div>
    <div class="hero-journal"><span class="overline" data-hero-journal-title>THE NEXT ROWS WILL BE CHECKED.</span>${['Ada Lovelace', 'Grace Hopper', 'Alan Turing'].map((name, i) => `<div data-hero-row="${i}"><span>0${i + 1}</span><span>${name}</span><span class="state pending" data-hero-state>pending</span></div>`).join('')}</div>
    <p class="visual-caption">Automatic illustration · CSV → customer records · sample data</p>
  </div>
</section>
<div class="wrap trust-strip"><p><strong>0</strong><span>Model calls to replay <br>the saved deterministic steps</span></p><p><strong>100<span>%</span></strong><span>RPA Challenge <br>70 of 70 fields</span></p><p><strong>Resume.</strong><span>Keep completed work. <br>Hold uncertain submissions.</span></p><a href="/use-cases/rpa-challenge">See the measured run ${arrow}</a></div>

<section class="section usefulness-section"><div class="wrap usefulness-layout"><div><p class="overline">THE WORK IT TAKES OFF YOUR HANDS</p><h2>Same clicks. <br>New data. <br><em>A useful routine.</em></h2><p>Use Ritoko when you already know what a successful task looks like, and need to repeat it across a list.</p></div><div class="usefulness-examples"><a href="/use-cases/customer-onboarding"><span class="overline">01 / CUSTOMER OPERATIONS</span><h3>Create customers from a CSV.</h3><p>Teach one form. Fill the next records from your spreadsheet and check that each customer exists.</p><span class="example-path">customers.csv <span>→</span> checked customer records ${arrow}</span></a><a href="/use-cases/reports-and-exports"><span class="overline">02 / REPORTING</span><h3>Collect the monthly exports.</h3><p>Save how to choose an account and a period. Run that routine again for the next month’s list.</p><span class="example-path">accounts + month <span>→</span> named report files ${arrow}</span></a><a href="/use-cases/browser-and-http"><span class="overline">03 / ADMINISTRATIVE WORK</span><h3>Update a list of records.</h3><p>Combine a browser and a verified API. Check the changes; hold an uncertain write for review.</p><span class="example-path">records + changes <span>→</span> checked results ${arrow}</span></a></div></div></section>

<section class="section process-section" id="process"><div class="wrap">
  <div class="section-intro"><p class="overline">01 / THE PROCESS</p><h2>One example taught. <br><em>A whole list handled.</em></h2><p>Follow a customer onboarding task from the first example to an interrupted batch. <br>The demonstration starts by itself. Choose any step to look more closely.</p></div>
  <div class="process-layout" data-process>
    <div class="process-chapters"><button class="chapter active" type="button" data-chapter="0" aria-current="step"><span class="chapter-number">01</span><span><strong>Do it once.</strong><small>Your agent works through the task. Browser actions are recorded; API and tool steps can be written directly.</small></span><span aria-hidden="true">↗</span></button><button class="chapter" type="button" data-chapter="1"><span class="chapter-number">02</span><span><strong>Keep the procedure.</strong><small>The agent defines the inputs, a business key, the submission boundary and the result checks.</small></span><span aria-hidden="true">↗</span></button><button class="chapter" type="button" data-chapter="2"><span class="chapter-number">03</span><span><strong>Let the rows run.</strong><small>Ritoko replays the saved steps without a model. Each item is checked and written to the journal.</small></span><span aria-hidden="true">↗</span></button><button class="chapter" type="button" data-chapter="3"><span class="chapter-number">04</span><span><strong>Continue, carefully.</strong><small>Verified work stays done. An uncertain submission waits for review. Safe remaining rows continue.</small></span><span aria-hidden="true">↗</span></button></div>
    <div class="process-stage"><div class="story-transport"><span><i class="status-dot"></i><span data-loop-status>Automatic demonstration</span></span><div><button type="button" data-loop-toggle>Ⅱ Pause demo</button><button type="button" data-loop-reset>↻ Restart</button></div></div><div class="phase-explanation" data-phase><span class="phase-tag">THE FIRST TIME · WITH YOUR AGENT</span><p>One example customer shows your agent how the task works.</p></div>${demo()}<div class="process-extra"><button class="button button-small button-outline" type="button" data-interrupt>Jump to the interruption ${arrow}</button><a class="text-link" href="/watch">See the actual recording ${arrow}</a></div></div>
  </div>
</div></section>

<section class="section recording-section"><div class="wrap"><div class="section-intro section-intro-row"><div><p class="overline">THE ENGINE, ON CAMERA</p><h2>See a real run. <br><em>Even when it stops.</em></h2></div><a class="text-link" href="/watch">Open the full recording ${arrow}</a></div>${recording()}<div class="recording-context"><p>This is Ritoko running against a local test back office. The process is killed after the fifth submission, then resumed. It finishes the remaining customers without resubmitting the verified ones.</p><p><strong>10 unique submissions.</strong> 9 verified, 1 held for review. <br>A deliberate 700 ms delay per submit makes the interruption visible.</p></div></div></section>

<section class="section feature-section"><div class="wrap"><div class="section-intro section-intro-row"><div><p class="overline">02 / THE WORK, IN VIEW</p><h2>Slow enough to follow. <br><em>Fast enough to matter.</em></h2></div><a class="text-link" href="/use-cases">Explore all use cases ${arrow}</a></div><a class="feature-case" href="/use-cases#rpa"><div class="feature-art"><div class="mini-form" aria-hidden="true"><span>RPA CHALLENGE / ROW 07</span><div><i>Company</i><b>IT Solutions</b></div><div class="mini-active"><i>First Name</i><b>John</b><span>02</span></div><div><i>Email</i><b>jsmith@example.test</b></div><div><i>Last Name</i><b>Smith</b></div><p>Labels stay useful. <br>Even when the fields move.</p></div><span class="art-caption">Slow showcase ↗</span></div><div class="feature-copy"><p class="overline">01 / BROWSER · MEASURED RUN</p><h3>Seventy fields. <br>One saved procedure.</h3><p>The RPA Challenge shuffles its fields after every submission. Ritoko’s replay completed all ten rows at 100%.</p><div class="case-numbers"><span><strong>100<small>%</small></strong><small>70 / 70 fields</small></span><span><strong>1.735<small>s</small></strong><small>Challenge’s own timer</small></span></div><span class="text-link">Follow the steps. Inspect the proof. ${arrow}</span></div></a><div class="case-teasers">${cases
  .filter((c) => ['resume', 'http', 'exports'].includes(c.id))
  .map(
    (c) =>
      `<a href="/use-cases#${c.id}"><span class="overline">${c.number} / ${c.category}</span><h3>${c.title}</h3><p>${c.subtitle}</p><span aria-hidden="true">↗</span></a>`,
  )
  .join('')}</div></div></section>

<section class="section journal-section" id="safety"><div class="wrap journal-layout"><div><p class="overline">03 / LASTING MEMORY</p><h2>A crash stops the run. <br><em>Not its memory.</em></h2><p>Every item has an outcome. On resume, the journal decides what can run and what needs a human check.</p><a class="text-link" href="/use-cases#resume">Watch the real crash &amp; resume ${arrow}</a><p class="small journal-boundary">The journal covers actions executed through this Ritoko installation. Each workflow supplies checks that prove its business result.</p></div><div class="memory-ledger"><div class="pane-label"><span>AFTER AN INTERRUPTION</span><span class="mono">run / 001</span></div><div class="memory-row"><span class="state done">done</span><span><strong>Verified. Kept.</strong><small>These rows are not submitted again.</small></span><span>04</span></div><div class="memory-row"><span class="state review">review</span><span><strong>Uncertain. Held.</strong><small>Check the site before resolving this item.</small></span><span>01</span></div><div class="memory-row"><span class="state pending">pending</span><span><strong>Not started. Ready.</strong><small>The remaining work can continue.</small></span><span>05</span></div><p><span class="status-dot"></span> Resume from the journal, not from zero.</p></div></div></section>
${install()}
${businessCta()}
<section class="section faq-section"><div class="wrap faq-layout"><div><p class="overline">A FEW USEFUL ANSWERS</p><h2>Before you <br><em>press replay.</em></h2></div><div class="faq">${[
  [
    'Does every replay use AI?',
    'Deterministic browser, HTTP and MCP steps replay without a model. Your agent is involved in learning the task and repairing a changed workflow. Reading a new document with an agent or OCR service is a separate per-document step.',
  ],
  [
    'What happens if a submission is uncertain?',
    'The item becomes review and is held across later runs. Check the result on the destination site, then resolve the item with an evidence note. Ritoko does not blindly submit it again.',
  ],
  [
    'Is this just a generated script?',
    'A script can replay too. Ritoko adds a per-item journal, frozen input rows, business-key deduplication, result checks, interruption handling and a review state for uncertain commits.',
  ],
  [
    'Can I use browsers, APIs and tools together?',
    'Yes. Workflows can combine browser, HTTP and MCP steps. Direct mode and host mode have different capabilities; the setup guide explains the supported paths and the host’s execution requirements.',
  ],
  [
    'Where does the data live?',
    'The workflow, item journal and run files live locally. Destination sites and tools receive the actions you configure. Your agent’s provider receives what the agent sends while learning or repairing the procedure.',
  ],
  [
    'What if the page changes or asks me to log in?',
    'A selector that stops matching pauses the run for repair. You complete login and MFA yourself in your authorized browser. Ritoko does not bypass CAPTCHAs or anti-bot protections.',
  ],
]
  .map(([q, a]) => `<details><summary>${q}<span aria-hidden="true">＋</span></summary><p>${a}</p></details>`)
  .join('')}</div></div></section>
</main>${footer()}`
writeFileSync(resolve(site, 'index.html'), home)

const showcase = `${head('Use cases — Ritoko', 'Follow the workflow in a slow showcase, then inspect the measured run. Browser forms, interrupted batches, files, HTTP and connected tools.', 'use-cases')}
${header('cases')}<main id="main" tabindex="-1"><section class="cases-hero wrap"><p class="overline">THE WORK, NOT JUST THE PROMISE.</p><h1>Watch the steps. <br><em>Then watch them fly.</em></h1><div class="cases-hero-bottom"><p>A slower view to understand the procedure. <br>A real run to see what happened.</p><span class="mono">06 USE CASES / ONE JOURNAL</span></div></section>
<section class="case-library wrap" aria-label="Use case showcase" data-case-library>
  ${cases.map((c) => `<span class="case-anchor" id="${c.id}" aria-hidden="true"></span>`).join('')}
  <div class="library-toolbar"><div class="filters" aria-label="Filter use cases">${['All', 'Browser', 'Files', 'Integrations'].map((c, i) => `<button type="button" data-filter="${c}" aria-pressed="${i === 0}">${c}${i === 0 ? ' <span>06</span>' : ''}</button>`).join('')}</div><span class="mono" data-case-count>6 procedures to explore</span></div>
  <div class="library-layout"><nav class="case-list" aria-label="Choose a use case">${cases.map((c, i) => `<button class="case-option ${i === 0 ? 'selected' : ''}" type="button" data-case="${c.id}" data-category="${c.category}" aria-pressed="${i === 0}"><span class="case-option-number">${c.number}</span><span><strong>${c.subtitle}</strong><small>${c.kind}</small></span><span aria-hidden="true">↗</span></button>`).join('')}<p class="library-note">Measured runs and workflow patterns are identified individually.</p></nav>
  <article class="case-detail"><div class="case-heading"><p class="overline" data-case-meta>01 / BROWSER · MEASURED RUN</p><h2 data-case-title>The changing form.</h2><p data-case-description>${cases[0].description}</p></div>
    <div class="showcase-toolbar"><div class="view-modes" aria-label="Showcase view"><button type="button" data-view="slow" aria-pressed="true">Slow showcase</button><button type="button" data-view="real" aria-pressed="false">Real time ${arrow}</button></div><span class="mono" data-mode-label>18 s · illustration</span></div>
    <div data-slow-view>${demo(true)}<div class="recipe-flow" data-recipe-view hidden><div class="recipe-heading"><span class="overline">A REPEATABLE PROCEDURE</span><span class="mono" data-recipe-input>accounts.csv</span></div><ol data-recipe-steps></ol><div class="recipe-result"><span class="status-dot"></span><span data-recipe-output>Named report files</span></div><p class="demo-caption">Workflow illustration. This is a supported pattern, not a recorded production run.</p></div></div>
    <div class="real-view" data-real-view hidden>
      <div data-rpa-proof><div class="real-result"><span class="overline">RPA CHALLENGE / MEASURED RESULT</span><div><strong>100<small>%</small></strong><p>70 of 70 fields. <br>10 rows completed.</p></div><p class="real-timing"><span>Challenge timer</span><strong>1,735 <small>ms</small></strong></p></div><figure class="proof-image"><a href="/assets/media/rpa-challenge-100.png" target="_blank" rel="noopener"><img src="/assets/media/rpa-challenge-100.png" width="1280" height="720" alt="RPA Challenge result showing 100% success, 70 out of 70 fields, in 1735 milliseconds." loading="lazy"></a><figcaption>Original result capture from the real run. Open to inspect. This is a still image, not a video recording.</figcaption></figure></div>
      <div data-video-proof hidden><video controls playsinline preload="metadata" poster="/assets/media/poster.png" width="1280" height="720"><source src="/assets/media/demo.webm" type="video/webm"><source src="/assets/media/demo.mp4" type="video/mp4"></video><p class="demo-caption">34.2 s · real time, no speed-up. A local batch is killed at row five, resumed, then run again.</p><div class="video-chapters" aria-label="Recording navigation"><button type="button" data-video-time="0">Start</button><button type="button" data-video-time="10">Interruption</button><button type="button" data-video-time="18">Resume</button><button type="button" data-video-time="27">Rerun</button></div></div>
    </div>
    <div class="case-story"><div><p class="overline">WHAT GOES IN</p><p class="story-value" data-case-input>challenge.xlsx</p></div><span aria-hidden="true">→</span><div><p class="overline">WHAT COMES OUT</p><p class="story-value" data-case-output>10 submitted forms</p></div></div>
    <div class="case-checks"><div><p class="overline">THE CHECKS</p><ul data-case-checks>${cases[0].checks.map((s) => `<li><span aria-hidden="true">✓</span>${s}</li>`).join('')}</ul></div><div><p class="overline">THE CONTEXT</p><p data-case-boundary>${cases[0].boundary}</p><a class="text-link" data-case-source href="${cases[0].source}">Inspect the workflow ${arrow}</a><a class="text-link case-guide" data-case-guide href="/use-cases/rpa-challenge">Read the full use case ${arrow}</a></div></div>
    <details class="measurement-notes" data-measurement><summary>What exactly was measured? <span aria-hidden="true">＋</span></summary><dl><div><dt>RPA Challenge’s own timer</dt><dd>1,735 ms</dd></div><div><dt>Journal duration, including setup &amp; checks</dt><dd>3,190 ms</dd></div><div><dt>CLI wall-clock duration</dt><dd>3,559 ms</dd></div><div><dt>Environment</dt><dd>Windows · Node 24 · headless Chrome</dd></div></dl><p>One measured run, recorded 3 October 2026. The 18-second showcase is an illustration slowed down for readability; it is not a performance measurement.</p><a class="text-link" href="/assets/media/facts.json" target="_blank" rel="noopener">Read the original measurements ${arrow}</a></details>
  </article></div>
</section><section class="section guide-directory"><div class="wrap"><p class="overline">FIND YOUR ROUTINE</p><h2>The use cases, <br><em>in detail.</em></h2><div class="guide-links">${casePages.map((p) => `<a href="/use-cases/${p.slug}"><span>${cases.find((c) => c.id === p.id).number}</span><h3>${p.title}</h3><span aria-hidden="true">↗</span></a>`).join('')}</div></div></section>${businessCta()}</main>${footer()}`
writeFileSync(resolve(site, 'use-cases.html'), showcase)

mkdirSync(resolve(site, 'use-cases'), { recursive: true })
for (const page of casePages) {
  const c = cases.find((item) => item.id === page.id)
  const route = `use-cases/${page.slug}`
  const proof =
    page.id === 'resume'
      ? recording()
      : page.id === 'rpa'
        ? '<figure class="editorial-proof"><a href="/assets/media/rpa-challenge-100.png"><img src="/assets/media/rpa-challenge-100.png" alt="Original RPA Challenge result: 100 percent, 70 correct fields, 1735 milliseconds" width="1280" height="720"></a><figcaption>Original measured result · 3 October 2026 · Windows, Node 24, headless Chrome.</figcaption></figure>'
        : ''
  const markup = `${head(page.metaTitle, page.description, route, [breadcrumb(c.subtitle, route)])}${header('cases')}<main id="main" tabindex="-1"><article class="editorial wrap"><a class="text-link" href="/use-cases">← All use cases</a><p class="overline">${c.number} / ${c.category.toUpperCase()} · ${c.kind.toUpperCase()}</p><h1>${page.title}</h1><p class="editorial-lede">${page.after}</p><div class="before-after"><div><p class="overline">THE WORK TODAY</p><p>${page.before}</p></div><div><p class="overline">WITH A SAVED PROCEDURE</p><p>${page.after}</p></div></div>${proof}<div class="editorial-body"><section><h2>What happens.</h2><p>${page.detail}</p><ol class="editorial-steps">${c.steps.map((step) => `<li>${step}</li>`).join('')}</ol><div class="case-story"><div><p class="overline">WHAT GOES IN</p><p class="story-value">${c.input}</p></div><span aria-hidden="true">→</span><div><p class="overline">WHAT COMES OUT</p><p class="story-value">${c.output}</p></div></div></section><section><h2>What makes it useful.</h2><p>${page.fit}</p><div class="editorial-checks"><p class="overline">THE CHECKS</p><ul>${c.checks.map((check) => `<li>✓ ${check}</li>`).join('')}</ul></div><p class="small">${c.boundary}</p><a class="text-link" href="${c.source}">Inspect the source ${arrow}</a><a class="text-link" href="/use-cases#${c.id}">Open the interactive showcase ${arrow}</a></section></div></article>${businessCta()}</main>${footer()}`
  writeFileSync(resolve(site, `${route}.html`), markup)
}

writeFileSync(
  resolve(site, 'watch.html'),
  `${head('Watch Ritoko: a real interrupted batch, resumed — Ritoko', 'Watch an actual customer batch interrupted after row five, resumed from its journal and run again. Ten unique submissions, one uncertain item held for review.', 'watch', [breadcrumb('Watch a real run', 'watch'), videoSchema])}${header()}<main id="main" tabindex="-1"><section class="watch-page wrap"><p class="overline">ACTUAL RECORDING / LOCAL TEST BACK OFFICE</p><h1>A run stops. <br><em>The work stays.</em></h1><p class="editorial-lede">Watch the process stop after the fifth submission, resume from the journal and run the same file again.</p>${recording()}<div class="watch-facts"><div><strong>10</strong><span>unique submissions received</span></div><div><strong>09</strong><span>verified customers kept</span></div><div><strong>01</strong><span>uncertain item held for review</span></div></div><div class="editorial-body"><section><h2>Follow the recording.</h2><ol class="editorial-steps"><li>Start a batch of ten customers.</li><li>Kill the process after the fifth reaches the server.</li><li>Resume: keep four done, hold one uncertain, finish five.</li><li>Run again: skip nine verified customers, hold the same review item.</li></ol></section><section><h2>What this proves.</h2><p>The local server accepts duplicates. Across this run, resume and rerun, it receives ten submissions with ten unique customer keys. Ritoko uses the saved item journal to avoid resubmitting completed work and to hold the unconfirmed fifth item.</p><p class="small">Recorded in real time, without speed-up. The test back office adds a deliberate 700 ms submission delay. This demonstrates interruption handling; it is not a production speed benchmark.</p><a class="text-link" href="/use-cases/customer-onboarding">Read the customer onboarding use case ${arrow}</a><a class="text-link" href="/benchmarks">Measurements and methodology ${arrow}</a></section></div></section>${businessCta()}</main>${footer()}`,
)

mkdirSync(resolve(site, 'contact'), { recursive: true })
writeFileSync(resolve(site, 'benchmarks.html'), benchmarks({ head, header, footer, breadcrumb, origin }))
writeFileSync(
  resolve(site, 'contact.html'),
  `${head('Automate your team’s workflow — Contact Ritoko', 'Have a repetitive business workflow? Tell Ritoko about your tools, input data, volume and expected result. Discuss a checked, resumable automation.', 'contact', [{ '@type': 'ContactPage', name: 'Discuss a workflow with Ritoko', url: `${origin}/contact`, mainEntity: { '@id': `${origin}/#organization` } }, breadcrumb('For businesses', 'contact')])}${header('contact')}<main id="main" tabindex="-1"><section class="contact-layout wrap"><div class="contact-copy"><p class="overline">FOR BUSINESSES / LET’S TALK ABOUT THE WORK</p><h1>A routine worth <br><em>handing over.</em></h1><p class="editorial-lede">Customer onboarding. Monthly exports. Record updates. Tell us what your team repeats and what a successful result looks like.</p><div class="contact-expect"><p class="overline">A USEFUL FIRST CONVERSATION</p><ol><li>Describe the task and the tools involved.</li><li>We discuss what can be repeated and checked.</li><li>We identify the exceptions that need a person.</li></ol></div><a class="contact-email text-link" href="mailto:${email}">${email} ${arrow}</a><p class="small">Prefer email? Write to us directly.</p></div><div class="contact-form-panel"><div class="contact-form-heading"><span class="overline">YOUR WORKFLOW</span><span class="mono">01 / START HERE</span></div><form data-contact-form action="https://formsubmit.co/${email}" method="POST"><input type="hidden" name="_subject" value="Ritoko — Business workflow request"><input type="hidden" name="_template" value="table"><input type="hidden" name="_url" value="${origin}/contact"><input type="hidden" name="_next" value="${origin}/contact/thanks"><div class="form-honey" aria-hidden="true"><label for="website">Leave this field empty</label><input id="website" name="_honey" tabindex="-1" autocomplete="off"></div><div class="contact-fields"><label for="contact-name">Your name <span>*</span><input id="contact-name" name="name" autocomplete="name" required maxlength="100"></label><label for="contact-email">Work email <span>*</span><input id="contact-email" name="email" type="email" autocomplete="email" required maxlength="254"></label><label for="contact-company">Company <span>*</span><input id="contact-company" name="company" autocomplete="organization" required maxlength="150"></label><label for="contact-tools">Tools involved<input id="contact-tools" name="tools" placeholder="e.g. a CRM, browser portal, spreadsheet" maxlength="300"></label><label for="contact-frequency">How often?<select id="contact-frequency" name="frequency"><option value="Not sure yet">Choose a frequency</option><option>Several times a day</option><option>Daily</option><option>Weekly</option><option>Monthly</option><option>Occasionally</option></select></label><label for="contact-volume">Typical volume<input id="contact-volume" name="volume" placeholder="e.g. 200 customers per week" maxlength="100"></label></div><label class="workflow-label" for="contact-workflow">What do you want to automate? <span>*</span><textarea id="contact-workflow" name="workflow" rows="6" required minlength="20" maxlength="4000" aria-describedby="workflow-hint" placeholder="What starts the task? What steps do you repeat? How do you know it succeeded?"></textarea></label><p id="workflow-hint" class="small">Describe the workflow. Please leave out passwords and private customer data.</p><div class="contact-send"><button class="button" type="submit" data-send>Send your workflow ${arrow}</button><span class="small">* Required</span></div><p class="form-status" data-form-status role="status" aria-live="polite"></p><p class="form-privacy">Your details are used to discuss this request. <a href="https://formsubmit.co/privacy.pdf" target="_blank" rel="noopener">FormSubmit</a> delivers the message. No marketing signup.</p><noscript><p class="small">Sending opens FormSubmit’s confirmation page. You can also use the email link.</p></noscript></form></div></section></main>${footer()}`,
)
writeFileSync(
  resolve(site, 'contact/thanks.html'),
  `${head('Request submitted — Ritoko', 'Your workflow request was submitted.', 'contact/thanks', [], true)}${header('contact')}<main id="main" class="wrap notfound"><p class="overline">THANK YOU / NEXT STEPS</p><h1>Let’s look <br><em>at the routine.</em></h1><p>Your request was submitted through FormSubmit. Keep our email address if you need to add anything.</p><a class="text-link" href="mailto:${email}">${email} ${arrow}</a><p><a class="button" href="/">Back to Ritoko ${arrow}</a></p></main>${footer()}`,
)
writeFileSync(
  resolve(site, '404.html'),
  `${head('Page not found — Ritoko', 'There is no page at this address.', '404', [], true)}${header()}<main id="main" class="wrap notfound"><p class="overline">404 / NO ENTRY HERE</p><h1>A little <br><em>off course.</em></h1><p>The page you’re looking for isn’t here. Your next good run is.</p><a class="button" href="/">Back to Ritoko ${arrow}</a></main>${footer()}`,
)

writeFileSync(
  resolve(site, 'privacy.html'),
  `${head('Website privacy — Ritoko', 'How Ritoko measures website use and how to choose whether to participate.', 'privacy')}${header('privacy')}<main id="main" tabindex="-1"><section class="editorial privacy-content wrap">${readFileSync(resolve(root, 'scripts/site/privacy.html'), 'utf8')}</section></main>${footer()}`,
)

const indexable = [
  '',
  'use-cases',
  ...casePages.map((p) => `use-cases/${p.slug}`),
  'watch',
  'benchmarks',
  'contact',
  'privacy',
]
writeFileSync(
  resolve(site, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexable.map((route) => `<url><loc>${origin}/${route}</loc></url>`).join('')}</urlset>\n`,
)
writeFileSync(
  resolve(site, 'video-sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"><url><loc>${origin}/watch</loc><video:video><video:thumbnail_loc>${origin}/assets/media/poster.png</video:thumbnail_loc><video:title>Ritoko: interrupt a customer batch, resume and rerun</video:title><video:description>An actual local back-office recording. Ten unique submissions, nine verified customers and one uncertain item held for review.</video:description><video:content_loc>${origin}/assets/media/demo.mp4</video:content_loc><video:duration>34</video:duration><video:publication_date>2026-10-03T02:11:38.055Z</video:publication_date></video:video></url></urlset>\n`,
)
const inventory = indexable.map((route) => ({
  url: `${origin}/${route}`,
  file: route ? `${route}.html` : 'index.html',
  indexable: true,
}))
mkdirSync(resolve(root, 'design/site-2026-10-03'), { recursive: true })
writeFileSync(
  resolve(root, 'design/site-2026-10-03/indexable-pages.json'),
  `${JSON.stringify(inventory, null, 2)}\n`,
)
console.log(`Built ${indexable.length} indexable pages, contact confirmation, 404 and both sitemaps.`)
