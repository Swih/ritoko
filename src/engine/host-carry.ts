/**
 * Short-lived local page for host mode uploads: it reads one file and opens the target URL with the file in
 * the fragment, so the site's page can rebuild it (sites' CSP forbid fetching from localhost directly).
 * Usage: node host-carry.ts <port> <file> <url> <fragment-name>
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname } from 'node:path'

const [port, file, to, name] = process.argv.slice(2) as [string, string, string, string]
const types: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
}
const quit = setTimeout(() => process.exit(0), 300_000)
createServer((req, res) => {
  if (req.url === '/ping') return res.end('ok')
  if (req.url === '/file') {
    res.setHeader('content-type', types[extname(file).toLowerCase()] ?? 'application/octet-stream')
    res.end(readFileSync(file))
    quit.refresh()
    setTimeout(() => process.exit(0), 60_000)
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><title>Ritoko</title><body style="background:#1c1a16;color:#f4f0e6;font:14px system-ui">Ritoko: preparing the upload…<script>
fetch('/file').then((r) => r.blob()).then((b) => new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b) }))
  .then((d) => location.replace(${JSON.stringify(to)} + '#' + ${JSON.stringify(name)} + '=' + encodeURIComponent(d)))
</script>`)
}).listen(Number(port), '127.0.0.1')
