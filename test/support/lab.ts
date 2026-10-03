import { createServer, type ServerResponse } from 'node:http'

export async function lab() {
  const submissions: { Email: string; Name: string }[] = []
  const uploads: string[] = []
  let holdKey: string | undefined
  let accepted: (() => void) | undefined
  let waiting: ServerResponse | undefined
  let rejectConfirmation = false
  let serverError = false
  let covered = false
  const html = (body: string) =>
    `<!doctype html><html><head><title>Ritoko Lab</title></head><body>${body}</body></html>`
  const escapeHtml = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    )
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/upload-form') {
      res.end(
        html(
          '<form method="post" action="/upload-file" enctype="multipart/form-data"><label for="file">CSV</label><input id="file" name="csv" type="file" onchange="this.form.submit()"></form>',
        ),
      )
      return
    }
    if (req.method === 'POST' && req.url === '/upload-file') {
      let body = ''
      for await (const chunk of req) body += chunk
      uploads.push(body)
      res.end(html(rejectConfirmation ? 'Response unavailable' : '<p role="status">Uploaded CSV</p>'))
      return
    }
    if (req.url === '/form') {
      const id = Math.random().toString(36).slice(2)
      res.end(
        html(`<form method="post" action="/submit">
        <label for="email-${id}">Email</label><input id="email-${id}" name="Email" required>
        <label for="name-${id}">Name</label><input id="name-${id}" name="Name" required>
        <button>Create customer</button></form>${covered ? '<div style="position:fixed;inset:0"></div>' : ''}`),
      )
      return
    }
    if (req.method === 'POST' && req.url === '/submit') {
      let body = ''
      for await (const chunk of req) body += chunk
      const values = new URLSearchParams(body)
      const item = { Email: values.get('Email') ?? '', Name: values.get('Name') ?? '' }
      submissions.push(item) // Intentionally accepts duplicates: the client must prevent them.
      if (serverError) {
        res.statusCode = 500
        res.end(html('<h1>Internal Server Error</h1>'))
        return
      }
      if (item.Email === holdKey) {
        waiting = res
        accepted?.()
      } else
        res.end(
          html(
            rejectConfirmation
              ? 'Response unavailable'
              : `<p role="status">Created ${escapeHtml(item.Email)}</p>`,
          ),
        )
      return
    }
    if (req.url === '/download') {
      res.setHeader('content-type', 'text/csv')
      res.setHeader('content-disposition', 'attachment; filename=..%2Foutside.csv')
      res.end('Email,Name\na@example.test,Ada\n')
      return
    }
    if (req.url === '/customers') {
      res.end(
        html(`<table aria-label="Customers">
        <thead><tr><th rowspan="2">Email</th><th colspan="2">Contact</th><th rowspan="2"></th></tr>
        <tr><th>Name</th><th>Note</th></tr></thead>
        <tbody><tr><td>user1@example.test</td><td> User
          1 </td><td>says "hi", ok</td><td><button>Edit</button></td></tr>
        <tr><td>user2@example.test</td><td>User 2</td><td><table><tr><td>a</td><td>b</td></tr></table></td><td></td></tr>
        <tr hidden><td>hidden@example.test</td><td>Hidden</td></tr>
        <tr><td>user3@example.test</td><td colspan="2">User 3</td><td></td></tr></tbody>
        <tfoot><tr><td colspan="4">3 customers</td></tr></tfoot></table>`),
      )
      return
    }
    if (req.url === '/widgets') {
      res.end(
        html(`<style>.sub{display:none} nav:hover .sub{display:inline}</style>
        <div contenteditable="true" role="textbox" aria-label="Note"></div>
        <button onclick="out.textContent = confirm('Delete record?') ? 'Deleted' : 'Kept'">Delete</button>
        <nav><span>Menu</span> <a class="sub" href="#" onclick="out.textContent = 'Archived'">Archive</a></nav>
        <p id="out" role="status"></p>`),
      )
      return
    }
    if (req.url === '/export') {
      res.end(html('<a href="/download">Export</a>'))
      return
    }
    if (req.url === '/tabs') {
      res.end(html('<a href="/form" target="_blank">New customer</a>'))
      return
    }
    if (req.url === '/login') {
      res.setHeader('set-cookie', ['session=1; Path=/', 'remember=1; Path=/; Max-Age=3600'])
      res.end(html('Signed in'))
      return
    }
    if (req.url === '/whoami') {
      res.end(html(`<p>${escapeHtml(req.headers.cookie ?? 'anonymous')}</p>`))
      return
    }
    if (req.url === '/checkboxes') {
      res.end(
        html(
          '<h3>Checkboxes</h3><form id="checkboxes"><input type="checkbox"> checkbox 1<br><input type="checkbox" checked> checkbox 2</form><p><input type="checkbox"><input type="checkbox"></p>',
        ),
      )
      return
    }
    if (req.url === '/framed') {
      res.end(html('<iframe title="Settings" src="/checkboxes"></iframe>'))
      return
    }
    res.end(html('<a href="/form">Customers</a>'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Lab did not start')
  return {
    url: `http://127.0.0.1:${address.port}`,
    submissions,
    uploads,
    hold(key: string) {
      holdKey = key
      return new Promise<void>((resolve) => {
        accepted = resolve
      })
    },
    release() {
      holdKey = undefined
      waiting?.end(html('<p role="status">Accepted</p>'))
      waiting = undefined
    },
    failConfirmation() {
      rejectConfirmation = true
    },
    failWithServerError() {
      serverError = true
    },
    coverForm(value: boolean) {
      covered = value
    },
    async close() {
      waiting?.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
