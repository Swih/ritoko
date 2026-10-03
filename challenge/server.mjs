// Ritoko Challenge: a clean, harder successor to rpachallenge.com, served locally with no dependencies.
//   node challenge/server.mjs [--port 4173] [--rows 10] [--job 20-90] [--latency 300-1500] [--seed 1] [--clean]
// --job is the AI studio duration range in seconds, --latency the submit delay range in milliseconds.
// Like a real back-office it accepts duplicates (it only counts them in /api/stats): preventing them is the
// client's job. Library: import { startChallenge } from './server.mjs'.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const ROLES = ['Engineer', 'Designer', 'Manager', 'Analyst', 'Support']
const FIRST = ['Ada', 'Grace', 'Alan', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Tim']
const LAST = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Torvalds',
  'Hamilton',
  'Ritchie',
  'Liskov',
  'Thompson',
  'Perlman',
  'Berners',
]
const COMPANIES = ['Northwind', 'Contoso', 'Initech', 'Hooli', 'Globex', 'Umbrella', 'Stark', 'Wayne']
const PROMPTS = [
  'a lighthouse at dawn in watercolor',
  'a robot barista pouring latte art',
  'a paper boat on a neon river',
  'a quiet street in the rain, film grain',
  'an astronaut watering a rooftop garden',
  'a fox reading a map by lantern light',
  'a futuristic train station at dusk',
  'a bowl of ramen, studio photograph',
]
const PAGE_SIZE = 5
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const range = (text, scale) => text.split('-').map((n) => Number(n) * scale)
const rand = () => randomBytes(4).toString('hex')
const between = ([lo, hi]) => lo + Math.random() * (hi - lo)
const shuffle = (list) =>
  list
    .map((v) => [Math.random(), v])
    .sort((a, b) => a[0] - b[0])
    .map((e) => e[1])

/** The input workbook: `rows` people, one with an invalid email that the server must reject. */
export function makeRows(rows, seed = 1, withBad = true) {
  let s = seed
  const next = (n) => {
    s = (s * 1103515245 + 12345) % 2 ** 31
    return Math.floor((s / 2 ** 31) * n)
  }
  const bad = Math.floor(rows * 0.6)
  return Array.from({ length: rows }, (_, i) => {
    const first = FIRST[next(FIRST.length)]
    const last = LAST[next(LAST.length)]
    const n = String(i + 1).padStart(2, '0')
    const prompt = PROMPTS[next(PROMPTS.length)]
    const email = `${first}.${last}.${n}@example.test`.toLowerCase()
    return {
      'First Name': first,
      'Last Name': last,
      Email: withBad && i === bad ? email.replace('@', '-at-') : email,
      Company: COMPANIES[next(COMPANIES.length)],
      Role: ROLES[next(ROLES.length)],
      'Start Date': `2026-${String(1 + next(12)).padStart(2, '0')}-${String(1 + next(28)).padStart(2, '0')}`,
      Phone: `555-01${String(next(100)).padStart(2, '0')}`,
      Prompt: prompt,
      Slug: `${n}-${prompt.split(' ').slice(1, 3).join('-')}`,
    }
  })
}

const csv = (rows) => {
  const cell = (v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)
  const head = Object.keys(rows[0])
  return `${head.join(',')}\n${rows.map((r) => head.map((h) => cell(r[h])).join(',')).join('\n')}\n`
}

/** A small valid PNG whose colors depend on the prompt. */
function png(seed) {
  const size = 256
  const h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = y * (size * 3 + 1) + 1 + x * 3
      const d = Math.hypot(x - 128, y - 128)
      raw[o] = (h + x) & 255
      raw[o + 1] = ((h >> 8) + y) & 255
      raw[o + 2] = ((h >> 16) + d * 2) & 255
    }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(size, 0)
  head.writeUInt32BE(size, 4)
  head.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export async function startChallenge({
  port = 0,
  rows = 10,
  job = '20-90',
  latency = '300-1500',
  seed = 1,
  bad = true,
} = {}) {
  let withBad = bad
  const jobMs = range(job, 1000)
  const latencyMs = range(latency, 1)
  const submissions = [] // every POST received, in order
  const accepted = []
  const rejected = new Set()
  const seen = new Set()
  const jobs = new Map()
  let startedAt = null
  let finishedAt = null
  let downloads = 0

  const stats = () => {
    const unique = new Set(accepted.map((a) => a.email)).size
    return {
      rows,
      started: startedAt !== null,
      finished: finishedAt !== null,
      elapsedMs: startedAt === null ? 0 : (finishedAt ?? Date.now()) - startedAt,
      submissions: submissions.length,
      accepted: accepted.length,
      rejected: rejected.size,
      unique,
      duplicates: accepted.length - unique,
      successRate: Math.round((unique / rows) * 100),
      jobs: jobs.size,
      downloads,
    }
  }
  const reset = (clean) => {
    if (clean !== undefined) withBad = !clean
    submissions.length = accepted.length = 0
    rejected.clear()
    seen.clear()
    jobs.clear()
    startedAt = finishedAt = null
    downloads = 0
  }

  const shell = (title, body, script = '') =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body>
<header><b>Ritoko Challenge</b><a href="/">Home</a><a href="/score">Score</a><span id="score">Score 0/${rows}</span><span id="timer">Time 00:00</span></header>
<main>${body}</main><script src="/app.js"></script>${script}</body></html>`

  const field = (label, control) => `<div class="field"><label>${label}</label>${control}</div>`

  const round = () => {
    const id = () => `f${rand()}`
    const ids = Object.fromEntries(
      ['first', 'last', 'email', 'company', 'role', 'date', 'terms'].map((k) => [k, id()]),
    )
    const text = (k, label) => field(label, `<input id="${ids[k]}" name="${id()}" autocomplete="off">`)
    const fields = shuffle([
      text('first', 'First Name'),
      text('last', 'Last Name'),
      text('email', 'Email'),
      text('company', 'Company'),
      field(
        'Role',
        `<select id="${ids.role}" name="${id()}"><option value="">Choose…</option>${ROLES.map((r) => `<option>${r}</option>`).join('')}</select>`,
      ),
      field('Start Date', `<input id="${ids.date}" name="${id()}" type="date">`),
      field('Phone', '<iframe title="Phone" src="/phone-frame"></iframe>'),
      `<div class="field"><input id="${ids.terms}" name="${id()}" type="checkbox"><span class="lbl" style="width:auto">I accept the terms</span></div>`,
    ])
    const script = `<script>
const ids = ${JSON.stringify(ids)}
const $ = (k) => document.getElementById(ids[k])
const submit = document.querySelector('#submit')
submit.onclick = async () => {
  const phone = document.querySelector('iframe').contentDocument.querySelector('input').value
  const data = { first: $('first').value, last: $('last').value, email: $('email').value, company: $('company').value,
    role: $('role').value, date: $('date').value, terms: $('terms').checked, phone }
  if (!confirm('Submit the entry for ' + data.email + '?')) return
  const result = document.querySelector('#result')
  result.hidden = true
  submit.disabled = true
  document.querySelector('#spinner').hidden = false
  const r = await fetch('/api/submit', { method: 'POST', body: JSON.stringify(data) })
  const body = await r.json()
  document.querySelector('#spinner').hidden = true
  submit.disabled = false
  result.className = r.ok ? 'ok' : 'err'
  result.setAttribute('role', r.ok ? 'status' : 'alert')
  result.textContent = r.ok ? 'Accepted: ' + data.email : 'Rejected: ' + body.error
  result.hidden = false
}
</script>`
    return shell(
      'Entry form',
      `<h1>New entry</h1><p class="lead">Fields move and ids change every round.</p>
<form onsubmit="return false">${fields.join('')}
<button type="button" id="submit">Submit</button><span class="spinner" id="spinner" hidden></span></form>
<p id="result" hidden></p>`,
      script,
    )
  }

  const studio = () => {
    const prompt = `p${rand()}`
    return shell(
      'AI studio',
      `<h1>AI studio</h1><p class="lead">Generation takes between ${job} seconds.</p>
<div class="card"><div class="field"><label>Prompt</label><textarea id="${prompt}" rows="3"></textarea></div>
<button type="button" id="generate">Generate</button></div>
<div class="card" id="job" hidden><b id="state">Queued</b><div class="bar" role="progressbar" aria-label="Generation progress"><i></i></div><div id="out"></div></div>`,
      `<script>
document.querySelector('#generate').onclick = async () => {
  const prompt = document.getElementById('${prompt}').value
  if (!prompt.trim()) return
  document.querySelector('#generate').disabled = true
  document.querySelector('#job').hidden = false
  const { id } = await (await fetch('/api/jobs', { method: 'POST', body: JSON.stringify({ prompt }) })).json()
  for (;;) {
    const j = await (await fetch('/api/jobs/' + id, { cache: 'no-store' })).json()
    document.querySelector('.bar i').style.width = j.progress + '%'
    document.querySelector('#state').textContent = j.status === 'done' ? 'Ready' : 'Generating ' + j.progress + '%'
    if (j.status === 'done') {
      document.querySelector('#out').innerHTML = '<a class="btn" href="' + j.file + '">Download</a>'
      return
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}
</script>`,
    )
  }

  const results = (page) => {
    const pages = Math.max(1, Math.ceil(accepted.length / PAGE_SIZE))
    const p = Math.min(Math.max(1, page), pages)
    const slice = accepted.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE)
    return shell(
      'Results',
      `<h1>Accepted entries</h1>
<table aria-label="Accepted entries"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th>Start Date</th></tr></thead><tbody>${slice
        .map(
          (a, i) =>
            `<tr><td>${(p - 1) * PAGE_SIZE + i + 1}</td><td>${esc(a.name)}</td><td>${esc(a.email)}</td><td>${esc(a.company)}</td><td>${esc(a.role)}</td><td>${esc(a.date)}</td></tr>`,
        )
        .join('')}</tbody></table>
<div class="pager">${p > 1 ? `<a href="/results?page=${p - 1}">Previous</a>` : ''}<span>Page ${p} of ${pages}</span>${p < pages ? `<a href="/results?page=${p + 1}">Next</a>` : ''}</div>`,
    )
  }

  const score = () => {
    const s = stats()
    const clock = new Date(s.elapsedMs).toISOString().slice(14, 19)
    return shell(
      'Score',
      `<h1>Score</h1><div class="card"><div class="big">Your success rate is ${s.successRate}%</div>
<p>Rows processed: ${seen.size} of ${rows}</p>
<p>Accepted: ${s.unique}</p><p>Rejected: ${s.rejected}</p><p>Duplicate submissions: ${s.duplicates}</p>
<p>Generated assets: ${s.downloads}</p><p>Time: ${clock}</p></div>`,
    )
  }

  const send = (res, type, body, status = 200, headers = {}) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers })
    res.end(body)
  }
  const html = (res, body, status) => send(res, 'text/html; charset=utf-8', body, status)
  const json = (res, body, status) => send(res, 'application/json', JSON.stringify(body), status)
  const readBody = async (req) => {
    let body = ''
    for await (const chunk of req) body += chunk
    return body ? JSON.parse(body) : {}
  }

  const validate = (d) => {
    if (!d.first?.trim() || !d.last?.trim() || !d.company?.trim())
      return 'First name, last name and company are required'
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.email ?? '')) return 'Invalid email address'
    if (!ROLES.includes(d.role)) return 'Choose a role'
    if (Number.isNaN(Date.parse(d.date ?? ''))) return 'Invalid start date'
    if (!/^[\d\s+()-]{6,}$/.test(d.phone ?? '')) return 'Invalid phone number'
    if (!d.terms) return 'You must accept the terms'
    return null
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    if (req.method === 'POST') {
      if (path === '/api/start') {
        startedAt ??= Date.now()
        return json(res, stats())
      }
      if (path === '/api/reset') {
        reset(url.searchParams.has('clean') ? true : undefined)
        return json(res, stats())
      }
      if (path === '/api/submit') {
        const d = await readBody(req)
        submissions.push(d)
        const error = validate(d)
        if (!error) accepted.push({ ...d, name: `${d.first} ${d.last}` })
        else rejected.add(d.email)
        seen.add(d.email)
        if (seen.size >= rows) finishedAt ??= Date.now() // Timer stops after the last row, accepted or not.
        // The server has stored the entry; only the answer is slow, which is where a crash hurts.
        await new Promise((r) => setTimeout(r, between(latencyMs)))
        return error ? json(res, { error }, 422) : json(res, { ok: true })
      }
      if (path === '/api/jobs') {
        const { prompt } = await readBody(req)
        const id = rand()
        const ms = between(jobMs)
        jobs.set(id, {
          prompt,
          startedAt: Date.now(),
          ms,
          file: `gen_${rand()}${rand()}_final(1).png`,
        })
        return json(res, { id })
      }
    }
    if (path === '/api/stats') return json(res, stats())
    if (path.startsWith('/api/jobs/')) {
      const j = jobs.get(path.slice('/api/jobs/'.length))
      if (!j) return json(res, { error: 'unknown job' }, 404)
      const progress = Math.min(100, Math.floor(((Date.now() - j.startedAt) / j.ms) * 100))
      return json(res, {
        status: progress >= 100 ? 'done' : 'running',
        progress,
        ...(progress >= 100 && { file: `/files/${encodeURIComponent(j.file)}` }),
      })
    }
    if (path.startsWith('/files/')) {
      const name = decodeURIComponent(path.slice('/files/'.length))
      const j = [...jobs.values()].find((e) => e.file === name)
      if (!j || Date.now() - j.startedAt < j.ms) return send(res, 'text/plain', 'Not found', 404)
      downloads++
      return send(res, 'image/png', png(j.prompt), 200, {
        'content-disposition': `attachment; filename="${name}"`,
      })
    }
    if (path === '/style.css' || path === '/app.js')
      return send(
        res,
        path.endsWith('css') ? 'text/css' : 'text/javascript',
        readFileSync(join(here, 'public', path)),
      )
    if (path === '/input.csv')
      return send(res, 'text/csv; charset=utf-8', csv(makeRows(rows, seed, withBad)), 200, {
        'content-disposition': 'attachment; filename="ritoko-challenge-input.csv"',
      })
    if (path === '/phone-frame')
      return html(
        res,
        `<!doctype html><meta charset="utf-8"><style>body{margin:0}input{width:100%;height:46px;box-sizing:border-box;font:17px "Segoe UI",system-ui,sans-serif;padding:0 12px;border:0}</style><input id="p${rand()}" placeholder="Phone number" autocomplete="off">`,
      )
    if (path === '/round') return html(res, round())
    if (path === '/studio') return html(res, studio())
    if (path === '/results') return html(res, results(Number(url.searchParams.get('page') ?? 1)))
    if (path === '/score') return html(res, score())
    if (path === '/')
      return html(
        res,
        shell(
          'Ritoko Challenge',
          `<h1>Ritoko Challenge</h1><p class="lead">${rows} people, one entry form that rearranges itself, one AI studio, one bad row. Fast, correct and never twice.</p>
<div class="card"><p><a class="btn" href="/input.csv" download>Download input spreadsheet</a></p>
<p><button type="button" id="start" onclick="fetch('/api/start',{method:'POST'}).then(() => { this.textContent = 'Started' })">Start</button></p>
<p>Open the <a href="/studio">AI studio</a>, the <a href="/round">entry form</a>, then the <a href="/results">results</a>.</p></div>`,
        ),
      )
    html(res, shell('Not found', '<h1>Not found</h1>'), 404)
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stats,
    reset,
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const flag = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : fallback
  }
  const site = await startChallenge({
    port: Number(flag('port', 4173)),
    rows: Number(flag('rows', 10)),
    job: flag('job', '20-90'),
    latency: flag('latency', '300-1500'),
    seed: Number(flag('seed', 1)),
    bad: !process.argv.includes('--clean'),
  })
  console.log(`Ritoko Challenge on ${site.url}`)
}
