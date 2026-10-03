import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../site/', import.meta.url))
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
}
createServer((req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  let file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (!file.startsWith(resolve(root) + sep)) {
    res.writeHead(403).end()
    return
  }
  let status = 200
  let stats
  try {
    if (!extname(file)) file += '.html'
    stats = statSync(file)
    if (!stats.isFile()) throw new Error('Not a file')
  } catch {
    file = resolve(root, '404.html')
    stats = statSync(file)
    status = 404
  }
  const headers = {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  }
  let start = 0
  let end = stats.size - 1
  if (req.headers.range && status === 200) {
    const range = req.headers.range.match(/^bytes=(\d+)-(\d*)$/)
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` }).end()
      return
    }
    start = Number(range[1])
    end = range[2] ? Math.min(Number(range[2]), end) : end
    if (start > end || start >= stats.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` }).end()
      return
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`
  }
  headers['Content-Length'] = end - start + 1
  res.writeHead(status, headers)
  if (req.method === 'HEAD') res.end()
  else createReadStream(file, { start, end }).pipe(res)
}).listen(8768, '127.0.0.1', () => console.log('Ritoko preview: http://127.0.0.1:8768'))
