// Tiny static server that mimics Vercel for the SPA: immutable hashed assets,
// no-store shell, SPA fallback, brotli/gzip on the fly. Used only by the bench harness.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

export function startServer(distDir, port = 0) {
  const root = path.resolve(distDir)
  const cache = new Map()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let rel = decodeURIComponent(url.pathname)
    let file = path.join(root, rel)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = rel.startsWith('/assets/') ? null : path.join(root, 'index.html')
    }
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
    const ext = path.extname(file)
    const immutable = rel.startsWith('/assets/')
    const accept = String(req.headers['accept-encoding'] ?? '')
    const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null
    const key = `${file}|${encoding}`
    let body = cache.get(key)
    if (!body) {
      const raw = fs.readFileSync(file)
      body = encoding === 'br' ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : encoding === 'gzip' ? zlib.gzipSync(raw) : raw
      cache.set(key, body)
    }
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      ...(encoding ? { 'content-encoding': encoding, vary: 'Accept-Encoding' } : {}),
      'content-length': body.length,
    })
    res.end(body)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })))
}
