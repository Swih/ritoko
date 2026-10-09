import { createServer } from 'node:http'

// Intentionally accepts duplicates: only the Ritoko journal prevents repeated writes.
export async function startService() {
  const customers = []
  let reads = 0
  const stats = () => ({
    writes: customers.length,
    unique: new Set(customers.map((customer) => customer.email)).size,
    reads,
  })
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'POST' && url.pathname === '/customers') {
        let body = ''
        for await (const chunk of request) {
          body += chunk
          if (body.length > 8192) throw new Error('Demo request too large')
        }
        const input = JSON.parse(body)
        if (!['email', 'name', 'company'].every((key) => typeof input[key] === 'string'))
          throw new Error('Expected email, name and company strings')
        const customer = {
          email: input.email,
          name: input.name,
          company: input.company,
          id: String(customers.length + 1),
        }
        customers.push(customer)
        response.statusCode = 201
        response.end(JSON.stringify(customer))
        return
      }
      if (request.method === 'GET' && /^\/customers\/\d+$/.test(url.pathname)) {
        const customer = customers.find((entry) => entry.id === url.pathname.split('/')[2])
        if (customer) {
          reads++
          response.end(JSON.stringify(customer))
          return
        }
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Not found' }))
    } catch (error) {
      response.statusCode = 400
      response.end(JSON.stringify({ error: error.message }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stats,
    async close() {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
