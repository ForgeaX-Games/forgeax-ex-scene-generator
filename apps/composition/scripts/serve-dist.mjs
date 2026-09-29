#!/usr/bin/env node
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { ensureWorkspacePackages } from '../../../scripts/ensure-workspace-packages.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
ensureWorkspacePackages(root)
const frontendDist = resolve(root, 'frontend/dist')
const backendEntry = resolve(root, 'backend/dist/main.js')
const frontendPort = Number(process.env.VITE_DEV_PORT ?? 9555)
const backendUrl = new URL(process.env.VITE_API_TARGET ?? `http://127.0.0.1:${process.env.PORT ?? 9557}`)
const backendPort = Number(backendUrl.port || (backendUrl.protocol === 'https:' ? 443 : 80))
const backendHost = backendUrl.hostname || '127.0.0.1'
const cert = process.env.VITE_DEV_HTTPS_CERT
const key = process.env.VITE_DEV_HTTPS_KEY
const useHttps = Boolean(cert && key && existsSync(cert) && existsSync(key))

function runBuild(label, args) {
  console.log(`[serve-dist] ${label} missing; running bun ${args.join(' ')}`)
  const result = spawnSync('bun', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) {
    console.error(`[serve-dist] ${label} build failed: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(join(frontendDist, 'index.html'))) {
  runBuild('frontend/dist', ['run', '--cwd', 'frontend', 'build'])
}
if (!existsSync(backendEntry)) {
  runBuild('backend/dist', ['run', '--cwd', 'backend', 'build'])
}

const backend = spawn(process.execPath, [backendEntry], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(backendPort),
    FORGEAX_SCENE_UI_URL: process.env.FORGEAX_SCENE_UI_URL ??
      `${useHttps ? 'https' : 'http'}://127.0.0.1:${frontendPort}/`,
  },
  stdio: 'inherit',
})

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.map', 'application/json; charset=utf-8'],
])

function proxyHttp(req, res) {
  const target = new URL(req.url ?? '/', `http://${backendHost}:${backendPort}`)
  const upstream = httpRequest({
    hostname: backendHost,
    port: backendPort,
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers: { ...req.headers, host: `${backendHost}:${backendPort}` },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `backend proxy failed: ${err.message}` }))
  })
  req.pipe(upstream)
}

async function handleRequest(req, res) {
  if (req.url === '/health' || req.url?.startsWith('/api/')) return proxyHttp(req, res)

  const parsed = new URL(req.url ?? '/', `http://127.0.0.1:${frontendPort}`)
  const pathname = decodeURIComponent(parsed.pathname)
  const requested = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let file = resolve(frontendDist, `.${requested}`)
  if (!file.startsWith(frontendDist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(frontendDist, 'index.html')
  }
  res.writeHead(200, {
    'content-type': mime.get(extname(file)) ?? 'application/octet-stream',
  })
  createReadStream(file).pipe(res)
}

const server = useHttps
  ? createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, handleRequest)
  : createHttpServer(handleRequest)

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy()
    return
  }
  const upstream = net.connect(backendPort, backendHost, () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`)
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) upstream.write(`${name}: ${item}\r\n`)
      } else if (value !== undefined) {
        upstream.write(`${name}: ${value}\r\n`)
      }
    }
    upstream.write('\r\n')
    if (head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on('error', () => socket.destroy())
})

function shutdown() {
  server.close()
  backend.kill('SIGTERM')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
backend.on('exit', (code) => {
  server.close(() => process.exit(code ?? 0))
})

server.listen(frontendPort, '0.0.0.0', () => {
  const protocol = useHttps ? 'https' : 'http'
  console.log(`[serve-dist] frontend ${protocol}://0.0.0.0:${frontendPort} -> ${frontendDist}`)
  console.log(`[serve-dist] backend http://${backendHost}:${backendPort}`)
})
