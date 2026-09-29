import Fastify from 'fastify'
import proxy from '@fastify/http-proxy'
import staticFiles from '@fastify/static'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = import.meta.dirname
const frontendPort = Number(process.env.VITE_DEV_PORT ?? 9555)
const backendPort = Number(process.env.PORT ?? 9557)
const uiUrl = process.env.FORGEAX_SCENE_UI_URL ?? `http://127.0.0.1:${frontendPort}/`
const upstream = `http://127.0.0.1:${backendPort}`
const projectRoot = resolve(process.env.FORGEAX_PROJECT_ROOT ?? join(homedir(), '.forgeax', 'scene-generator'))

const app = Fastify()
for (const prefix of ['/api', '/health', '/ws']) {
  await app.register(proxy, {
    upstream,
    prefix,
    rewritePrefix: prefix,
    http: {},
    destroyAgent: true,
    websocket: prefix === '/ws',
  })
}
await app.register(staticFiles, { root: join(root, 'modules/composition/dist/frontend') })
await app.listen({ port: frontendPort, host: '0.0.0.0' })

const backend = spawn('bun', ['modules/composition/dist/server/main.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(backendPort),
    FORGEAX_PROJECT_ROOT: projectRoot,
    FORGEAX_SCENE_UI_URL: uiUrl,
  },
  stdio: 'inherit',
})
const backendExit = once(backend, 'exit')
await once(backend, 'spawn')

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await app.close()
  backend.kill('SIGTERM')
  await backendExit
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown)
void backendExit.then(async ([code]) => {
  if (shuttingDown) return
  shuttingDown = true
  await app.close()
  process.exit(code || 1)
})
console.log(`[scene-generator] UI ${uiUrl}; API ${upstream}; projects ${projectRoot}`)
