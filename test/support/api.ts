import { createServer, type IncomingHttpHeaders } from 'node:http'

export type Seen = { method: string; path: string; headers: IncomingHttpHeaders; body: string }

/** A small JSON API on a random port, recording every request it gets. */
export async function api() {
  const seen: Seen[] = []
  let orders = 0
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const url = new URL(req.url ?? '/', 'http://api.test')
    seen.push({ method: req.method ?? '', path: url.pathname, headers: req.headers, body })
    const reply = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(value))
    }
    const hits = seen.filter((r) => r.method === req.method && r.path === url.pathname).length
    switch (`${req.method} ${url.pathname}`) {
      case 'GET /token':
        return reply(200, { token: 't-123', nested: { n: 5, ok: true }, list: ['a', 'b'] })
      case 'GET /vary':
        return reply(200, hits === 1 ? { id: 'first' } : {})
      case 'POST /orders':
        return reply(201, { id: `o-${++orders}` })
      case 'GET /flaky':
        return hits <= 2 ? reply(503, { retry: true }, { 'retry-after': '0' }) : reply(200, { ok: true })
      case 'POST /flaky':
        return reply(503, { retry: true }, { 'retry-after': '0' })
      case 'GET /hang':
      case 'POST /hang':
        return // never answers: the client must give up
      case 'POST /once':
        // The first attempt of each key hangs, as if the connection was lost after it was sent.
        return seen.filter(
          (r) => r.path === '/once' && r.headers['idempotency-key'] === req.headers['idempotency-key'],
        ).length === 1
          ? undefined
          : reply(201, { id: 'once' })
      case 'GET /file':
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(Buffer.from([0, 1, 2, 255]))
      case 'GET /moved':
        return reply(302, {}, { location: '/token' })
      case 'GET /away':
      case 'POST /away':
        return reply(
          req.method === 'POST' ? 307 : 302,
          {},
          { location: `${url.searchParams.get('to')}/headers` },
        )
      case 'GET /headers':
        return reply(200, { headers: req.headers })
      case 'POST /echo':
        return reply(201, { headers: req.headers, body })
      case 'POST /leak':
        return reply(500, { error: 'bad credentials', authorization: req.headers.authorization })
      default:
        if (req.method === 'GET' && url.pathname.startsWith('/orders/'))
          return reply(200, { id: url.pathname.slice(8), status: 'paid' })
        return reply(404, { error: 'not found' })
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('API did not start')
  return {
    url: `http://127.0.0.1:${address.port}`,
    seen,
    count: (method: string, path: string) =>
      seen.filter((r) => r.method === method && r.path === path).length,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
