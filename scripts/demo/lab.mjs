// Tiny back-office used by the Ritoko demo: a "New customer" form (Email, Name, Company) and a dashboard that
// shows what the SERVER actually received. Like a real system it accepts duplicates, so only the client side
// (Ritoko's journal) can prevent a double send. `latencyMs` adds a fixed delay to each submit so the footage is
// watchable; `hold(key)` keeps the HTTP response of one submission open after the server stored it, which lets the
// demo kill the CLI at the worst possible moment.
// Standalone: node scripts/demo/lab.mjs [port]   (library: import { startLab } from './lab.mjs')
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const css = `
*{box-sizing:border-box}body{margin:0;font:17px/1.45 "Segoe UI",system-ui,sans-serif;color:#1d2433;background:#f3f5f9;display:flex;min-height:100vh}
aside{width:210px;background:#17202e;color:#c9d3e6;padding:22px 18px;flex:none}
aside b{display:block;color:#fff;font-size:19px;margin-bottom:22px;letter-spacing:.2px}
aside a{display:block;color:#c9d3e6;text-decoration:none;padding:9px 12px;border-radius:8px;margin-bottom:4px}
aside a.on{background:#2a3850;color:#fff}
main{flex:1;padding:28px 34px;min-width:0}
h1{font-size:25px;margin:0 0 18px}
.tiles{display:flex;gap:16px;margin-bottom:22px}
.tile{background:#fff;border-radius:12px;padding:14px 20px;box-shadow:0 1px 3px #0001;min-width:200px}
.tile small{display:block;color:#5b6679;font-size:14px}.tile strong{font-size:34px;line-height:1.15}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px #0001}
th,td{text-align:left;padding:9px 16px;border-bottom:1px solid #edf0f5;font-size:16px}
th{background:#fafbfd;color:#5b6679;font-weight:600;font-size:14px}
td.n{color:#8a94a6;width:50px}
form{background:#fff;border-radius:12px;padding:26px 28px;max-width:560px;box-shadow:0 1px 3px #0001}
label{display:block;font-weight:600;margin:14px 0 5px}
input{width:100%;font:inherit;padding:10px 12px;border:1px solid #c5cdda;border-radius:8px}
button{margin-top:22px;font:inherit;font-weight:600;background:#2f6fed;color:#fff;border:0;padding:11px 22px;border-radius:8px}
.ok{background:#e7f6ec;border:1px solid #9fd5b0;color:#175c2f;border-radius:10px;padding:14px 18px;max-width:560px;font-weight:600}
a.back{display:inline-block;margin-top:18px;color:#2f6fed}
`
const shell = (title, on, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>
<aside><b>Northwind Back-office</b><a class="${on === 'c' ? 'on' : ''}" href="/">Customers</a><a class="${on === 'n' ? 'on' : ''}" href="/form">New customer</a></aside>
<main>${body}</main></body></html>`

export async function startLab({ port = 0, latencyMs = 0 } = {}) {
  const submissions = []
  let holdKey
  let accepted
  let waiting
  const stats = () => ({
    received: submissions.length,
    unique: new Set(submissions.map((s) => s.Email)).size,
  })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    if (url.pathname === '/api/count') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(stats()))
      return
    }
    if (url.pathname === '/api/stats') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ...stats(), submissions }))
      return
    }
    if (url.pathname === '/form') {
      res.end(
        shell(
          'New customer',
          'n',
          `<h1>New customer</h1><form method="post" action="/submit">
<label for="email">Email</label><input id="email" name="Email" required autocomplete="off">
<label for="name">Name</label><input id="name" name="Name" required autocomplete="off">
<label for="company">Company</label><input id="company" name="Company" required autocomplete="off">
<button>Create customer</button></form>`,
        ),
      )
      return
    }
    if (req.method === 'POST' && url.pathname === '/submit') {
      let body = ''
      for await (const chunk of req) body += chunk
      const v = new URLSearchParams(body)
      const item = { Email: v.get('Email') ?? '', Name: v.get('Name') ?? '', Company: v.get('Company') ?? '' }
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs))
      submissions.push(item) // accepts duplicates on purpose
      if (item.Email === holdKey) {
        waiting = res
        accepted?.()
        return
      }
      res.end(
        shell(
          'Customer created',
          'n',
          `<h1>New customer</h1><p class="ok" role="status">Created ${esc(item.Email)}</p><a class="back" href="/form">Add another</a>`,
        ),
      )
      return
    }
    // dashboard: server-side truth, refreshed from /api/stats
    res.end(
      shell(
        'Customers',
        'c',
        `<h1>Customers</h1><div class="tiles">
<div class="tile"><small>Submissions received</small><strong id="r">0</strong></div>
<div class="tile"><small>Unique emails</small><strong id="u">0</strong></div></div>
<table><thead><tr><th>#</th><th>Email</th><th>Name</th><th>Company</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const e=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
async function tick(){const d=await (await fetch('/api/stats')).json();r.textContent=d.received;u.textContent=d.unique;
rows.innerHTML=d.submissions.map((s,i)=>'<tr><td class="n">'+(i+1)+'</td><td>'+e(s.Email)+'</td><td>'+e(s.Name)+'</td><td>'+e(s.Company)+'</td></tr>').join('')}
tick();setInterval(tick,500)</script>`,
      ),
    )
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    stats,
    submissions,
    /** Resolves once the server stored the submission with this key; its response stays open until release(). */
    hold(key) {
      holdKey = key
      return new Promise((resolve) => {
        accepted = resolve
      })
    },
    release() {
      holdKey = undefined
      waiting?.end(
        shell('Customer created', 'n', `<h1>New customer</h1><p class="ok" role="status">Accepted</p>`),
      )
      waiting = undefined
    },
    async close() {
      waiting?.destroy()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lab = await startLab({ port: Number(process.argv[2] ?? 4310), latencyMs: 0 })
  console.log(`lab on ${lab.url}`)
}
