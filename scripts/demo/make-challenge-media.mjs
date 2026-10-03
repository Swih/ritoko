// Films the Ritoko Challenge from REAL runs of this checkout and proves its guarantees on the way. Run from anywhere:
//   node scripts/demo/make-challenge-media.mjs [outDir] [--hd] [--job 4-8]
// Needs: Node 24+, `pnpm install` done, Google Chrome (or RITOKO_CHROME_PATH), ffmpeg on PATH.
// Everything uses throwaway RITOKO_HOME dirs under the OS temp dir (never ~/.ritoko) and local challenge servers.
// Outputs in outDir (default: <tmp>/ritoko-challenge-media), never inside the repository:
//   replay.mp4    full batch (10 rows, AI jobs, extraction, score) then the same batch again: nothing resent
//   crash.mp4     SIGKILL in the middle of a submission, report, resume, rerun, resolve
//   challenge-score.png, challenge-form.png, challenge-studio.png, journal-report.png, downloads-folder.png
//   facts.json    the measured numbers
// The video is the Ritoko Chrome tab (CDP screencast) next to the real CLI output, the live journal and the
// server's own counters. --hd renders 1920x1080 instead of 1280x720. Terminal paths show ~/.ritoko.
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { Workflow } from '../../src/engine/schema.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const HD = args.includes('--hd')
const JOB = flag('job', '4-8')
const out = resolve(
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ??
    join(tmpdir(), 'ritoko-challenge-media'),
)
mkdirSync(out, { recursive: true })
const base = mkdtempSync(join(tmpdir(), 'ritoko-challenge-'))
const log = (...a) => console.log('[challenge]', ...a)
const facts = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  os: `${process.platform} ${process.arch}`,
  job: JOB,
}
const cleanups = []

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
const stageBrowser = await chromium.launch({ executablePath: chromeExe(), headless: true })

/** A challenge server in its own process; `stats()` is what the server itself counted. */
async function startServer({ rows = 10, job = JOB, latency = '400-1200', clean = true } = {}) {
  const child = spawn(
    process.execPath,
    [
      'challenge/server.mjs',
      '--port',
      '0',
      '--rows',
      String(rows),
      '--job',
      job,
      '--latency',
      latency,
      ...(clean ? ['--clean'] : []),
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  )
  const [chunk] = await once(child.stdout, 'data')
  const url = chunk.toString().match(/http:\/\/\S+/)[0]
  cleanups.push(async () => child.kill())
  return { url, stats: async () => (await fetch(`${url}/api/stats`)).json() }
}

/** Runs the real CLI. `done` resolves with its combined output, exit code and wall time. */
function ritoko(cliArgs, home) {
  const t0 = performance.now()
  const child = spawn(process.execPath, ['bin/ritoko.mjs', ...cliArgs], {
    cwd: root,
    env: { ...process.env, RITOKO_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let text = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (text += d))
  const done = new Promise((res) =>
    child.on('close', (code) => res({ code, out: text, ms: Math.round(performance.now() - t0) })),
  )
  return { child, done }
}

/** Shows the throwaway home as the default ~/.ritoko, and refuses to leak a personal path. */
function sanitize(text, home) {
  let t = text
  for (const f of [home.replaceAll('\\', '\\\\'), home]) t = t.replaceAll(f, '~/.ritoko')
  t = t.replace(/~\/\.ritoko[^\s"]*/g, (m) => m.replaceAll('\\\\', '/').replaceAll('\\', '/'))
  if (t.includes(tmpdir()) || t.includes(homedir().split(/[\\/]/).pop()))
    throw new Error('Personal path leaked')
  return t
}
const lines = (text) =>
  text
    .replace(/\r/g, '')
    .trimEnd()
    .split('\n')
    .map((t) => ({ t: 'out', text: t }))

/** Folds the middle of the `report` JSON, keeping the items whose idx is in `keep`. */
function foldReport(text, keep) {
  const src = text.replace(/\r/g, '').trimEnd().split('\n')
  const res = []
  let hidden = []
  const flush = () => {
    if (hidden.length)
      res.push({
        t: 'fold',
        text: `    ... ${hidden.length} more rows, same format (#${hidden.join(', #')})`,
      })
    hidden = []
  }
  for (let i = 0; i < src.length; ) {
    if (src[i] === '    {') {
      let j = i
      while (!src[j].startsWith('    }')) j++
      const idx = Number(src[i + 1].match(/"idx": (\d+)/)[1])
      if (keep.includes(idx)) {
        flush()
        for (let k = i; k <= j; k++) res.push({ t: 'out', text: src[k] })
      } else hidden.push(idx + 1)
      i = j + 1
    } else {
      if (hidden.length && src[i].startsWith('  ]')) flush()
      res.push({ t: 'out', text: src[i++] })
    }
  }
  return res
}

const termJs = readFileSync(join(here, 'term.js'), 'utf8')
const RitokoTerm = (() => {
  const w = {}
  new Function('window', termJs)(w)
  return w.RitokoTerm
})()

/** A still of terminal text, as a window. */
async function terminalPng(file, title, termLines) {
  const page = await stageBrowser.newPage({ viewport: { width: 1060, height: 400 }, deviceScaleFactor: 2 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:transparent;font:14.5px/1.5 "Cascadia Mono",Consolas,monospace;color:#d6deeb}
.win{background:#0b0f15;border:1px solid #2a3140;border-radius:12px;overflow:hidden;width:1060px}
.tb{height:36px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#1d2430;color:#8b95a9;font:13px "Segoe UI",sans-serif}
.tb i{width:12px;height:12px;border-radius:50%;background:#46506a}.tb span{margin-left:10px}
.body{padding:14px 18px 18px}${RitokoTerm.css}</style>
<div class="win"><div class="tb"><i></i><i></i><i></i><span>${title}</span></div><div class="body">${termLines.map((l) => RitokoTerm.line(l)).join('')}</div></div>`)
  await page.locator('.win').screenshot({ path: join(out, file) })
  await page.close()
}

/** The challenge workflow, validated, saved under `name` after `change`. */
function workflowFile(name = 'ritoko-challenge', change = (text) => text) {
  const example = readFileSync(join(root, 'examples', 'ritoko-challenge.json'), 'utf8')
  Workflow.parse(JSON.parse(example))
  const text = change(example.replace('"name": "ritoko-challenge"', `"name": "${name}"`))
  const file = join(base, `${name}.json`)
  writeFileSync(file, text)
  return file
}

/** The Ritoko Chrome pane, the terminal, the journal and the server counters, filmed as one video. */
async function openStage(home, server) {
  const scale = HD ? 1.5 : 1
  const page = await (
    await stageBrowser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale })
  ).newPage()
  await page.setContent(
    readFileSync(join(here, 'challenge-stage.html'), 'utf8')
      .replace('/*TERMJS*/', termJs)
      .replace('/*TERMCSS*/', RitokoTerm.css),
  )
  const call = (m, ...a) => page.evaluate(([m, a]) => window.stage[m](...a), [m, a]).catch(() => {})
  const frames = []
  const rec = await page.context().newCDPSession(page)
  rec.on('Page.screencastFrame', (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data })
    rec.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await rec.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: 1280 * scale,
    maxHeight: 720 * scale,
    everyNthFrame: 1,
  })

  // Raw CDP, not Playwright: a Playwright client without a dialog handler would dismiss the confirm() that
  // Ritoko is answering.
  let port
  let tab
  let socket
  const follow = async () => {
    const file = join(home, 'profile', 'DevToolsActivePort')
    if (!existsSync(file)) return
    port ??= readFileSync(file, 'utf8').split(/\r?\n/)[0]
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
      (t) => t.type === 'page',
    )
    if (!target) return
    call('url', target.url.replace('http://', ''))
    if (target.id === tab && socket?.readyState === 1) return
    socket?.close()
    tab = target.id
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    socket = ws
    let n = 0
    const send = (method, params) => ws.send(JSON.stringify({ id: ++n, method, params }))
    ws.onopen = () => {
      send('Emulation.setDeviceMetricsOverride', {
        width: 960,
        height: 577,
        deviceScaleFactor: 1,
        mobile: false,
      })
      send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: 960,
        maxHeight: 577,
        everyNthFrame: 1,
      })
    }
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.method !== 'Page.screencastFrame') return
      call('frame', m.params.data)
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId })
    }
  }
  let busy = false
  const poll = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      call('server', await server.stats())
      await follow().catch(() => {})
      const db = new DatabaseSync(join(home, 'ritoko.db'), { readOnly: true })
      const runId = db.prepare('SELECT id FROM runs ORDER BY started_at DESC, rowid DESC LIMIT 1').get()?.id
      if (runId)
        call(
          'journal',
          db.prepare('SELECT idx, key, status FROM items WHERE run_id = ? ORDER BY idx').all(runId),
        )
      db.close()
    } catch {}
    busy = false
  }, 250)

  const stage = {
    say: (text, kind) => call('caption', text, kind),
    add: (l) => call('add', l),
    clear: () => call('clear'),
    /** Runs the CLI with its command and (trimmed) output shown in the terminal. */
    async cli(cliArgs, { show = 14, keep = [] } = {}) {
      stage.add({ t: 'cmd', text: ['node', 'bin/ritoko.mjs', ...cliArgs].join(' ') })
      const run = ritoko(cliArgs, home)
      const res = await run.done
      const text = sanitize(res.out, home)
      for (const l of cliArgs[0] === 'report' ? foldReport(text, keep) : lines(text).slice(0, show))
        stage.add(l)
      return { ...res, text, child: run.child }
    },
    start: (cliArgs) => ritoko(cliArgs, home),
    async finish(name) {
      await delay(2500)
      clearInterval(poll)
      await rec.send('Page.stopScreencast')
      await page.screenshot({ path: join(out, `${name}-poster.png`) })
      writeVideo(frames, `${name}.mp4`)
      socket?.close()
      await page.context().close()
    },
  }
  return stage
}

function writeVideo(frames, name) {
  const dir = mkdtempSync(join(base, 'frames-'))
  const list = frames.flatMap((f, i) => {
    writeFileSync(join(dir, `f${i}.jpg`), Buffer.from(f.data, 'base64'))
    return [
      `file 'f${i}.jpg'`,
      `duration ${Math.max(0.001, (frames[i + 1]?.ts ?? f.ts + 3) - f.ts).toFixed(4)}`,
    ]
  })
  writeFileSync(join(dir, 'list.txt'), [...list, `file 'f${frames.length - 1}.jpg'`].join('\n'))
  const size = HD ? '1920:1080' : '1280:720'
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(dir, 'list.txt'),
      '-vf',
      `fps=25,scale=${size}:in_range=pc:out_range=tv,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '23',
      '-movflags',
      '+faststart',
      '-an',
      join(out, name),
    ],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
}

const parse = (text) => JSON.parse(text)
const sizes = (dir) =>
  readdirSync(dir)
    .sort()
    .map((name) => ({ name, kb: (statSync(join(dir, name)).size / 1024).toFixed(1) }))

/** Scene 1: the whole batch, then the same batch again. */
async function replay() {
  log('scene 1: full replay')
  const home = join(base, 'replay')
  const server = await startServer()
  const stage = await openStage(home, server)
  const wf = workflowFile()
  await ritoko(['import', wf], home).done
  stage.say(`1 | replay: 10 rows, a changing form, AI jobs of ${JOB} s`)
  await delay(1500)
  const run = await stage.cli(['run', 'ritoko-challenge', '--param', `base=${server.url}`, '--headless'], {
    show: 9,
  })
  const report = parse((await ritoko(['report'], home).done).out)
  const after = await server.stats()
  facts.replay = {
    status: report.status,
    counts: report.counts,
    runMs: run.ms,
    journalMs: report.durationMs,
    exitCode: run.code,
    server: after,
  }
  stage.say(
    `${after.successRate}% | ${after.accepted} accepted | ${after.duplicates} duplicates | ${(run.ms / 1000).toFixed(0)} s`,
    'good',
  )
  await delay(4000)
  stage.say('2 | run the same spreadsheet again', 'warn')
  const again = await stage.cli(['run', 'ritoko-challenge', '--param', `base=${server.url}`, '--headless'], {
    show: 4,
  })
  const stats = await server.stats()
  facts.rerun = { ms: again.ms, line: again.text.split('\n')[0].replace(/^\S+/, '<runId>'), server: stats }
  stage.say(
    `nothing resent | server still at ${stats.submissions} submissions, ${stats.duplicates} duplicates`,
    'good',
  )
  await stage.finish('replay')

  // Stills from the same run.
  const ctx = await stageBrowser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.goto(`${server.url}/score`)
  await delay(800)
  await p.screenshot({ path: join(out, 'challenge-score.png') })
  await ctx.close()
  const dir = report.dir.replace(home, '~/.ritoko').replaceAll('\\', '/')
  await terminalPng('downloads-folder.png', 'ritoko', [
    { t: 'cmd', text: `ls -l ${dir.replace(/[^/]+$/, '<runId>')}` },
    ...sizes(report.dir).map(({ name, kb }) => ({ t: 'out', text: `${kb.padStart(7)} KB  ${name}` })),
  ])
  facts.replay.files = sizes(report.dir).map((f) => f.name)

  // A selector that no longer matches pauses the run for repair instead of guessing.
  const broken = workflowFile('ritoko-challenge-broken', (t) =>
    t.replace("//label[normalize-space()='Prompt']", "//label[normalize-space()='Description']"),
  )
  await ritoko(['import', broken], home).done
  const paused = await ritoko(
    ['run', 'ritoko-challenge-broken', '--param', `base=${server.url}`, '--headless'],
    home,
  ).done
  facts.brokenSelector = {
    exitCode: paused.code,
    firstLine: sanitize(paused.out, home).split('\n')[0].replace(/^\S+/, '<runId>'),
    submissionsAfter: (await server.stats()).submissions,
  }
  await ritoko(['cancel', parse((await ritoko(['report'], home).done).out).runId], home).done
  await ritoko(['browser-close'], home).done
}

/** Scene 2: the process dies while the server is answering a submission. */
async function crash() {
  log('scene 2: crash and resume')
  const home = join(base, 'crash')
  const server = await startServer({ job: '2-3', latency: '1500-2500' })
  const stage = await openStage(home, server)
  await ritoko(['import', workflowFile()], home).done
  const KILL_AT = 5
  const runArgs = ['run', 'ritoko-challenge', '--param', `base=${server.url}`, '--headless']
  stage.say('1 | run the batch')
  await delay(1500)
  stage.add({ t: 'cmd', text: ['node', 'bin/ritoko.mjs', ...runArgs].join(' ') })
  const first = ritoko(runArgs, home)
  while ((await server.stats()).submissions < KILL_AT) await delay(40)
  stage.say(`2 | SIGKILL: the server already stored row ${KILL_AT}`, 'bad')
  first.child.kill('SIGKILL')
  await first.done
  const killed = await server.stats()
  stage.add({ t: 'note', text: `CLI killed (SIGKILL) while row ${KILL_AT} was being answered` })
  await delay(2500)
  stage.clear()
  stage.say('3 | the journal knows where it stopped', 'warn')
  const rep = await stage.cli(['report'], { keep: [KILL_AT - 2, KILL_AT - 1, KILL_AT] })
  const killedReport = parse(rep.out)
  facts.crash = {
    killedAtRow: KILL_AT,
    serverAtKill: killed,
    afterKill: { status: killedReport.status, counts: killedReport.counts },
  }
  await terminalPng('journal-report.png', 'ritoko', [
    { t: 'cmd', text: 'node bin/ritoko.mjs report' },
    ...foldReport(sanitize(rep.out, home), [KILL_AT - 2, KILL_AT - 1, KILL_AT]),
  ])
  await delay(3500)
  stage.clear()
  stage.say(`4 | resume: row ${KILL_AT} is not sent again`, 'warn')
  const resumed = await stage.cli(['resume', killedReport.runId, '--headless'], { show: 6 })
  const afterResume = await server.stats()
  facts.crash.resume = {
    exitCode: resumed.code,
    ms: resumed.ms,
    line: resumed.text.split('\n')[0].replace(killedReport.runId, '<runId>'),
    server: afterResume,
  }
  stage.say(
    `${afterResume.accepted} accepted | ${afterResume.duplicates} duplicates | 1 item held for review`,
    'good',
  )
  await delay(3500)
  stage.clear()
  stage.say('5 | the held row: check the site, then resolve it', 'warn')
  const key = parse((await ritoko(['report', killedReport.runId], home).done).out).items.find(
    (i) => i.status === 'review',
  ).key
  const resolved = await stage.cli(
    ['resolve', killedReport.runId, key, 'done', '--note', 'Server list shows this entry once'],
    { show: 4 },
  )
  const finished = await stage.cli(['resume', killedReport.runId, '--headless'], { show: 7 })
  const end = await server.stats()
  facts.crash.final = {
    resolveExit: resolved.code,
    resumeLine: finished.text.split('\n')[0].replace(killedReport.runId, '<runId>'),
    server: end,
  }
  stage.say(`done | ${end.accepted} accepted | ${end.duplicates} duplicates | ${end.successRate}%`, 'good')
  await stage.finish('crash')
  await ritoko(['browser-close'], home).done
}

/** Stills of the form and of the AI studio mid-generation. */
async function pages() {
  const server = await startServer({ job: '30-30' })
  const ctx = await stageBrowser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.goto(`${server.url}/round`)
  const row = {
    'First Name': 'Ada',
    'Last Name': 'Lovelace',
    Email: 'ada.lovelace@example.test',
    Company: 'Northwind',
  }
  for (const [label, value] of Object.entries(row))
    await p.locator(`xpath=//label[normalize-space()='${label}']/following::input[1]`).fill(value)
  await p.screenshot({ path: join(out, 'challenge-form.png') })
  await p.goto(`${server.url}/studio`)
  await p.getByRole('textbox').fill('a lighthouse at dawn in watercolor')
  await p.getByRole('button', { name: 'Generate' }).click()
  await p.getByText('Generating 4').or(p.getByText('Generating 5')).first().waitFor()
  await p.screenshot({ path: join(out, 'challenge-studio.png') })
  await ctx.close()
}

try {
  facts.chrome = stageBrowser.version()
  await replay()
  await crash()
  await pages()
  writeFileSync(join(out, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
  log('done', out, JSON.stringify(facts, null, 2))
} finally {
  for (const c of cleanups.reverse()) await c().catch(() => {})
  await stageBrowser.close().catch(() => {})
  for (const home of ['replay', 'crash'])
    if (existsSync(join(base, home))) await ritoko(['browser-close'], join(base, home)).done
  for (let i = 0; i < 30; i++) {
    try {
      rmSync(base, { recursive: true, force: true })
      break
    } catch {
      await delay(200)
    }
  }
}
