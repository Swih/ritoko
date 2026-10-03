// Regenerates every demo asset in site/assets/media/ from REAL runs of this checkout. Run from anywhere:
//   node scripts/demo/make-media.mjs
// Needs: Node 24+, `pnpm install` done (playwright-core), Google Chrome (or RITOKO_CHROME_PATH), ffmpeg on PATH,
// curl on PATH, internet access (the RPA Challenge part uses https://rpachallenge.com).
// It uses throwaway RITOKO_HOME dirs under the OS temp dir (never ~/.ritoko), starts a local back-office
// (scripts/demo/lab.mjs), drives the real CLI (`node bin/ritoko.mjs ...`) and kills it for real (SIGKILL).
// Terminal images show the CLI's real output; the only edits are (1) your temp RITOKO_HOME is printed as
// ~/.ritoko with / separators, (2) the long `report` JSON has its middle items folded under an explicit marker,
// (3) colors. Lines on an amber bar are annotations by this script, not CLI output.
// Outputs: rpa-challenge-100.png, lab-batch.png(+webp), term-1..4 PNG, crash-resume-terminal.png,
// demo.mp4, demo.webm, poster.png, facts.json. The demo runs in real time (no speed-up).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startLab } from './lab.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const media = join(root, 'site', 'assets', 'media')
mkdirSync(media, { recursive: true })
const base = mkdtempSync(join(tmpdir(), 'ritoko-demo-'))
const LATENCY_MS = 700
const CSV = 'scripts/demo/customers.csv'
const HOLD_ROW = 5
const chrome = chromeExe()
const stageBrowser = await chromium.launch({ executablePath: chrome, headless: true })
const log = (...a) => console.log('[media]', ...a)

function chromeExe() {
  if (process.env.RITOKO_CHROME_PATH) return process.env.RITOKO_CHROME_PATH
  const c =
    process.platform === 'win32'
      ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
          .filter(Boolean)
          .map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  const found = c.find(existsSync)
  if (!found) throw new Error('Chrome not found; set RITOKO_CHROME_PATH')
  return found
}

/** Runs the real CLI. `done` resolves with its combined output, exit code and wall time. */
function ritoko(args, home) {
  const t0 = performance.now()
  const child = spawn(process.execPath, ['bin/ritoko.mjs', ...args], {
    cwd: root,
    env: { ...process.env, RITOKO_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let out = ''
  child.stdout.on('data', (d) => {
    out += d
  })
  child.stderr.on('data', (d) => {
    out += d
  })
  const done = new Promise((res) =>
    child.on('close', (code, signal) => res({ code, signal, out, ms: Math.round(performance.now() - t0) })),
  )
  return { child, done }
}

/** Presentation only: show the throwaway home as the default ~/.ritoko. */
function sanitize(text, home) {
  const forms = [home.replaceAll('\\', '\\\\'), home]
  let t = text
  for (const f of forms) t = t.replaceAll(f, '~/.ritoko')
  t = t.replace(/~\/\.ritoko[^\s"]*/g, (m) => m.replaceAll('\\\\', '/').replaceAll('\\', '/'))
  const user = homedir().split(/[\\/]/).pop()
  if (t.includes(tmpdir()) || t.includes(user)) throw new Error('Personal path leaked into terminal text')
  return t
}

/** Folds the middle of the `report` JSON (keeps item idx in `keep`); returns terminal lines. */
function foldReport(text, keep) {
  const lines = text.replace(/\r/g, '').trimEnd().split('\n')
  const out = []
  let hidden = []
  const flush = () => {
    if (hidden.length)
      out.push({
        t: 'fold',
        text: `    ⋯ ${hidden.length} rows folded (${hidden.join(', ')}), same format ⋯`,
      })
    hidden = []
  }
  for (let i = 0; i < lines.length; ) {
    if (lines[i] === '    {') {
      let j = i
      while (!lines[j].startsWith('    }')) j++
      const idx = Number(lines[i + 1].match(/"idx": (\d+)/)[1])
      if (keep.includes(idx)) {
        flush()
        for (let k = i; k <= j; k++) out.push({ t: 'out', text: lines[k] })
      } else hidden.push(idx + 1)
      i = j + 1
    } else {
      if (hidden.length && lines[i].startsWith('  ]')) flush()
      out.push({ t: 'out', text: lines[i] })
      i++
    }
  }
  return out
}

const outLines = (text) =>
  text
    .replace(/\r/g, '')
    .trimEnd()
    .split('\n')
    .map((t) => ({ t: 'out', text: t }))

async function attach(home) {
  const file = join(home, 'profile', 'DevToolsActivePort')
  for (let i = 0; i < 300; i++) {
    if (existsSync(file)) {
      const [port, route] = readFileSync(file, 'utf8').trim().split(/\r?\n/)
      try {
        const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${route}`, { timeout: 2000 })
        const page = browser.contexts()[0]?.pages().at(-1)
        if (page) return { browser, page, version: browser.version() }
      } catch {}
    }
    await delay(100)
  }
  throw new Error('Could not attach to the Ritoko Chrome')
}

async function rpaChallenge() {
  const home = join(base, 'rpa')
  log('RPA Challenge: import + run')
  await ritoko(['import', 'examples/rpa-challenge.json'], home).done
  const run = await ritoko(['run', 'rpa-challenge', '--repeat', '--headless'], home).done
  log(run.out.split('\n')[0])
  const report = JSON.parse((await ritoko(['report'], home).done).out)
  const { browser, page } = await attach(home)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  await delay(800)
  const text = await page.innerText('body')
  const m = text.match(/success rate is (\d+)% \( (\d+) out of (\d+) fields\) in (\d+) milliseconds/)
  if (m?.[1] !== '100') throw new Error(`RPA Challenge did not reach 100%: ${text.slice(0, 300)}`)
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(media, 'rpa-challenge-100.png'), Buffer.from(shot.data, 'base64'))
  facts.rpaChallenge = {
    workflow: 'examples/rpa-challenge.json',
    status: report.status,
    rows: report.counts.done,
    fields: Number(m[3]),
    scorePercent: Number(m[1]),
    siteReportedMs: Number(m[4]),
    journalDurationMs: report.durationMs,
    cliWallClockMs: run.ms,
    exitCode: run.code,
  }
  await browser.close()
  await ritoko(['browser-close'], home).done
}

async function crashDemo() {
  const home = join(base, 'crash')
  const rows = readFileSync(join(root, CSV), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split(','))
  const lab = await startLab({ port: 4310, latencyMs: LATENCY_MS }).catch(() =>
    startLab({ latencyMs: LATENCY_MS }),
  )
  cleanups.push(() => lab.close())
  const workflow = {
    name: 'customers',
    description: 'Create customers from a CSV in the back-office',
    params: {
      input: { description: 'CSV with Email,Name,Company' },
      base: { description: 'back-office URL', default: lab.url },
    },
    items: { from: '{{param.input}}', key: '{{item.Email}}', scope: '{{param.base}}' },
    setup: [{ id: 'setup', do: 'goto', url: '{{param.base}}/' }],
    item: [
      { id: 'open', do: 'goto', url: '{{param.base}}/form' },
      ...['Email', 'Name', 'Company'].map((f) => ({
        id: f.toLowerCase(),
        do: 'fill',
        target: { primary: { by: 'label', text: f }, fallbacks: [] },
        value: `{{item.${f}}}`,
      })),
      {
        id: 'submit',
        do: 'click',
        commit: true,
        target: { primary: { by: 'role', role: 'button', name: 'Create customer' }, fallbacks: [] },
      },
      { id: 'verify', do: 'expect', text: 'Created {{item.Email}}', timeoutMs: 5000 },
    ],
  }
  const wfFile = join(base, 'customers.workflow.json')
  writeFileSync(wfFile, JSON.stringify(workflow, null, 2))
  await ritoko(['import', wfFile], home).done

  // ---- stage page (browser pane + terminal + live journal), recorded with CDP screencast ----
  const stage = await (await stageBrowser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  const html = readFileSync(join(here, 'stage.html'), 'utf8')
    .replace('/*TERMJS*/', readFileSync(join(here, 'term.js'), 'utf8'))
    .replace('/*TERMCSS*/', await termCss())
  await stage.setContent(html)
  const call = (m, ...a) => stage.evaluate(([m, a]) => window.stage[m](...a), [m, a]).catch(() => {})
  const frames = []
  const rec = await stage.context().newCDPSession(stage)
  rec.on('Page.screencastFrame', (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data })
    rec.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })

  const shots = { 1: [], 2: [], 3: [], 4: [] }
  const emit = (beat, l) => {
    shots[beat].push(l)
    call('add', l)
  }
  const cmdText = (args) => ['node', 'bin/ritoko.mjs', ...args].join(' ')
  // async on purpose: the lab server lives in this process, a spawnSync would deadlock it
  const curl = (path) =>
    new Promise((res, rej) => {
      const c = spawn('curl', ['-s', '-m', '10', lab.url + path])
      let out = ''
      c.stdout.on('data', (d) => {
        out += d
      })
      c.on('error', rej)
      c.on('close', () => res(out))
    })
  const proof = async (beat) => {
    emit(beat, { t: 'cmd', text: `curl -s ${lab.url}/api/count` })
    emit(beat, { t: 'out', text: await curl('/api/count') })
  }
  const begin = (_beat, caption, kind = '') => {
    call('clear')
    call('caption', caption, kind)
  }

  // live pollers: journal (read-only SQLite), server counts, browser URL
  let ritokoPage
  const poll = setInterval(async () => {
    call('server', lab.stats().received, lab.stats().unique)
    try {
      const db = new DatabaseSync(join(home, 'ritoko.db'), { readOnly: true })
      const runId = db.prepare('SELECT id FROM runs ORDER BY started_at DESC, rowid DESC LIMIT 1').get()?.id
      if (runId)
        call(
          'journal',
          db.prepare('SELECT idx, key, status FROM items WHERE run_id = ? ORDER BY idx').all(runId),
        )
      db.close()
    } catch {}
    if (ritokoPage && !ritokoPage.isClosed()) call('url', ritokoPage.url().replace('http://', ''))
  }, 250)
  cleanups.push(async () => clearInterval(poll))

  await rec.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 88,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1,
  })
  await delay(1200)

  // ---- beat 1: run, then hard kill ----
  log('beat 1: run + kill')
  begin(1, `1 · run a ${rows.length}-row CSV`)
  const holdKey = rows[HOLD_ROW - 1][0]
  const accepted = lab.hold(holdKey)
  const runArgs = ['run', 'customers', '--param', `input=${CSV}`, '--headless']
  emit(1, { t: 'cmd', text: cmdText(runArgs) })
  const run1 = ritoko(runArgs, home)
  const ritokoChrome = await Promise.race([
    attach(home),
    run1.done.then((r) => {
      throw new Error(`run exited early: ${r.out}`)
    }),
  ])
  ritokoPage = ritokoChrome.page
  facts.chrome = ritokoChrome.version
  const cdp = await ritokoPage.context().newCDPSession(ritokoPage)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 960,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  })
  cdp.on('Page.screencastFrame', async (f) => {
    await call('frame', f.data)
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 960,
    maxHeight: 600,
    everyNthFrame: 1,
  })
  cleanups.push(() => ritokoChrome.browser.close())
  await Promise.race([
    accepted,
    run1.done.then((r) => {
      throw new Error(`run exited before the crash point: ${r.out}`)
    }),
  ])
  await delay(1000)
  call('caption', `2 · hard kill (SIGKILL): the server already stored row ${HOLD_ROW}`, 'bad')
  const killedAt = lab.stats()
  run1.child.kill('SIGKILL')
  const killed = await run1.done
  emit(1, {
    t: 'note',
    text: `■ CLI process killed (SIGKILL). Output so far: ${killed.out.trim() ? JSON.stringify(killed.out) : 'nothing'}`,
  })
  await proof(1)
  facts.killAfterServerCount = killedAt
  await delay(1800)
  lab.release()
  await delay(1200)

  // ---- beat 2: report ----
  log('beat 2: report')
  begin(2, '3 · report: the journal knows exactly where it stopped')
  emit(2, { t: 'cmd', text: cmdText(['report']) })
  const rep = await ritoko(['report'], home).done
  const repJson = JSON.parse(rep.out)
  const repText = sanitize(rep.out, home)
  for (const l of foldReport(repText, [HOLD_ROW - 2, HOLD_ROW - 1, HOLD_ROW])) emit(2, l)
  facts.afterKill = { status: repJson.status, counts: repJson.counts }
  call(
    'caption',
    `3 · report: ${Object.entries(repJson.counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')}`,
    'warn',
  )
  await delay(3500)

  // ---- beat 3: resume ----
  log('beat 3: resume')
  begin(3, '4 · resume: only what is left, row 5 is not resent', 'warn')
  const resumeArgs = ['resume', repJson.runId, '--headless']
  emit(3, { t: 'cmd', text: cmdText(resumeArgs) })
  const resumed = await ritoko(resumeArgs, home).done
  for (const l of outLines(sanitize(resumed.out, home))) emit(3, l)
  emit(3, { t: 'note', text: `■ exit code ${resumed.code} (non-zero because one item needs a human check)` })
  await proof(3)
  const afterResume = JSON.parse(await curl('/api/count'))
  facts.resume = {
    exitCode: resumed.code,
    wallClockMs: resumed.ms,
    line: sanitize(resumed.out, home).split('\n')[0].replace(repJson.runId, '<runId>'),
  }
  call(
    'caption',
    `5 · ${afterResume.unique} unique submissions on the server, 1 item held for review`,
    'good',
  )
  await delay(3500)

  // ---- beat 4: run the same CSV again ----
  log('beat 4: rerun')
  begin(4, '6 · run the same CSV again: nothing is sent twice')
  emit(4, { t: 'cmd', text: cmdText(runArgs) })
  const rerun = await ritoko(runArgs, home).done
  for (const l of outLines(sanitize(rerun.out, home))) emit(4, l)
  emit(4, { t: 'note', text: `■ exit code ${rerun.code}` })
  await proof(4)
  const final = JSON.parse(await curl('/api/count'))
  facts.rerun = {
    exitCode: rerun.code,
    wallClockMs: rerun.ms,
    line: sanitize(rerun.out, home).split('\n')[0].replace(/^\S+/, '<runId>'),
  }
  call(
    'caption',
    `${final.received} received · ${final.unique} unique · 1 review: row ${HOLD_ROW} waits for a human`,
    'good',
  )
  await delay(4500)
  await stage.screenshot({ path: join(media, 'poster.png') }) // final state: 10 unique submissions, 1 review
  await rec.send('Page.stopScreencast')
  clearInterval(poll)

  // ---- stills ----
  const ctx = await stageBrowser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  const labPage = await ctx.newPage()
  await labPage.goto(`${lab.url}/`)
  await labPage.waitForFunction(() => document.querySelectorAll('#rows tr').length >= 10)
  await labPage.screenshot({ path: join(media, 'lab-batch.png') })
  await ctx.close()

  facts.crashDemo = {
    rows: rows.length,
    killedAtRow: HOLD_ROW,
    killSignal: 'SIGKILL',
    labLatencyMsPerSubmit: LATENCY_MS,
    submissionsReceived: final.received,
    uniqueSubmissions: final.unique,
  }
  const finalReport = JSON.parse((await ritoko(['report', repJson.runId], home).done).out)
  facts.crashDemo.reviewItems = finalReport.items.filter((i) => i.status === 'review').length
  facts.crashDemo.resumedRunCounts = finalReport.counts
  facts.crashDemo.resumedRunStatus = finalReport.status

  const bundles = [
    { n: 1, title: '1 · run, killed mid-batch' },
    { n: 2, title: '2 · report: what the journal knows' },
    { n: 3, title: '3 · resume: only what is left' },
    { n: 4, title: '4 · run the same CSV again' },
  ]
  for (const b of bundles) await renderTerm(b.n, shots[b.n])
  await renderGrid(bundles, shots)

  // ---- video ----
  buildVideo(frames)
  ffmpeg(['-y', '-i', join(media, 'lab-batch.png'), '-quality', '85', join(media, 'lab-batch.webp')])
  await stage.close()
}

async function termCss() {
  const page = await stageBrowser.newPage()
  await page.setContent(`<script>${readFileSync(join(here, 'term.js'), 'utf8')}</script>`)
  const css = await page.evaluate(() => window.RitokoTerm.css)
  await page.close()
  return css
}

const termPage = (inner, extra = '') => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:transparent;font:14.5px/1.5 "Cascadia Mono",Consolas,monospace;color:#d6deeb}
.win{background:#0b0f15;border:1px solid #2a3140;border-radius:12px;overflow:hidden;width:1060px}
.tb{height:36px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#1d2430;color:#8b95a9;font:13px "Segoe UI",sans-serif}
.tb i{width:12px;height:12px;border-radius:50%;background:#46506a}.tb span{margin-left:10px}
.body{padding:14px 18px 18px}${extra}</style><body>${inner}</body>`

const winHtml = (lines, title = 'ritoko · ~/ritoko') =>
  `<div class="win"><div class="tb"><i></i><i></i><i></i><span>${title}</span></div><div class="body">${lines.map((l) => RitokoTermLine(l)).join('')}</div></div>`

const termJs = readFileSync(join(here, 'term.js'), 'utf8')
// the same colorizer as the stage, evaluated in node (it only needs `window`)
const RitokoTerm = (() => {
  const w = {}
  new Function('window', termJs)(w)
  return w.RitokoTerm
})()
function RitokoTermLine(l) {
  return RitokoTerm.line(l)
}

async function renderTerm(n, lines) {
  const page = await stageBrowser.newPage({ viewport: { width: 1060, height: 400 }, deviceScaleFactor: 2 })
  await page.setContent(termPage(winHtml(lines), RitokoTerm.css))
  await page.locator('.win').screenshot({
    path: join(media, `term-${n}-${['run', 'report', 'resume', 'rerun'][n - 1]}.png`),
    omitBackground: true,
  })
  await page.close()
}

async function renderGrid(bundles, shots) {
  const page = await stageBrowser.newPage({ viewport: { width: 2300, height: 600 }, deviceScaleFactor: 1.5 })
  const cells = bundles
    .map((b) => `<div class="cell"><h3>${b.title}</h3>${winHtml(shots[b.n])}</div>`)
    .join('')
  await page.setContent(
    termPage(
      `<div class="grid">${cells}</div>`,
      `${RitokoTerm.css}body{background:#0d1117}.grid{display:grid;grid-template-columns:1060px 1060px;gap:26px;padding:30px;align-items:start}
.cell h3{margin:0 0 10px;font:600 17px "Segoe UI",sans-serif;color:#e6edf3}`,
    ),
  )
  await page.locator('.grid').screenshot({ path: join(media, 'crash-resume-terminal.png') })
  await page.close()
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
}

function buildVideo(frames) {
  const dir = join(base, 'frames')
  mkdirSync(dir, { recursive: true })
  const list = []
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'))
    const next = frames[i + 1]?.ts ?? f.ts + 3
    list.push(`file '${name}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`)
  })
  list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`)
  writeFileSync(join(dir, 'list.txt'), list.join('\n'))
  const common = [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(dir, 'list.txt'),
    '-vf',
    'fps=25,scale=1280:720:in_range=pc:out_range=tv,format=yuv420p',
  ]
  ffmpeg([
    ...common,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '28',
    '-movflags',
    '+faststart',
    '-an',
    join(media, 'demo.mp4'),
  ])
  ffmpeg([
    ...common,
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '38',
    '-row-mt',
    '1',
    '-an',
    join(media, 'demo.webm'),
  ])
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(media, 'demo.mp4')],
    { encoding: 'utf8' },
  )
  facts.video = { durationSeconds: Number(Number(probe.stdout).toFixed(1)), speedUp: 'none, real time' }
}

const facts = {
  generatedAt: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10),
  ritokoVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  node: process.version,
  os: `${process.platform} ${process.arch}`,
  headless: true,
}
const cleanups = []
try {
  facts.chrome = stageBrowser.version()
  await rpaChallenge()
  await crashDemo()
  writeFileSync(join(media, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
  log('done', facts)
} finally {
  for (const c of cleanups.reverse()) await c().catch(() => {})
  await stageBrowser.close().catch(() => {})
  for (const home of [join(base, 'rpa'), join(base, 'crash')])
    if (existsSync(home)) await ritoko(['browser-close'], home).done
  for (let i = 0; i < 30; i++) {
    try {
      rmSync(base, { recursive: true, force: true })
      break
    } catch {
      await delay(200)
    }
  }
}
