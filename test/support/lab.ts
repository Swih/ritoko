import { createServer, type ServerResponse } from 'node:http'

export async function lab() {
  const submissions: { Email: string; Name: string }[] = []
  const uploads: string[] = []
  let holdKey: string | undefined
  let accepted: (() => void) | undefined
  let waiting: ServerResponse | undefined
  let rejectConfirmation = false
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
        <button>Create customer</button></form>`),
      )
      return
    }
    if (req.method === 'POST' && req.url === '/submit') {
      let body = ''
      for await (const chunk of req) body += chunk
      const values = new URLSearchParams(body)
      const item = { Email: values.get('Email') ?? '', Name: values.get('Name') ?? '' }
      submissions.push(item) // Intentionally accepts duplicates: the client must prevent them.
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
    if (req.url === '/export') {
      res.end(html('<a href="/download">Export</a>'))
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
    async close() {
      waiting?.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
