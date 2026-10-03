/**
 * Short-lived local pages that carry the runtime, plans and files of host mode into the site's page: the
 * agent's browser opens http://127.0.0.1:<port>/<n>, which replaces itself with the target URL and a
 * `#ritoko=` fragment (a fragment never leaves the browser, and sites' CSP forbid fetching from localhost).
 * Reads a JSON array of {target, fragment} on stdin, prints its port, exits 60 s after every page was
 * served (the agent may retry a navigation), or after 5 minutes.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk)
const pages = JSON.parse(Buffer.concat(chunks).toString()) as { target: string; fragment: string }[]
const served = new Set<number>()
setTimeout(() => process.exit(0), 300_000)

const server = createServer((req, res) => {
  const n = Number(req.url?.slice(1))
  const page = pages[n]
  // Only a browser on this machine, asking for this address: not a DNS-rebinding page.
  if (!page || req.headers.host !== `127.0.0.1:${(server.address() as AddressInfo).port}`) {
    res.statusCode = 404
    return res.end()
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><title>Ritoko</title><body style="background:#1c1a16;color:#f4f0e6;font:14px system-ui">Ritoko…<script>
location.replace(${JSON.stringify(page.target).replaceAll('<', '\\u003c')} + '#ritoko=' + ${JSON.stringify(page.fragment)})
</script>`)
  served.add(n)
  if (served.size === pages.length) setTimeout(() => process.exit(0), 60_000)
})
server.listen(0, '127.0.0.1', () => console.log((server.address() as AddressInfo).port))
