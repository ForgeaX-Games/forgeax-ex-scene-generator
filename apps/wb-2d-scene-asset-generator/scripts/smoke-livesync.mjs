// Proves the North-Star live-sync: an external CLI/HTTP graph mutation is
// forwarded over /ws so the UI's useGraphSync refetches → the canvas updates
// live ("watch the AI work"). Boots the backend in-process, subscribes a WS
// client to the graph channel, POSTs a node, and asserts a forwarded event.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-livesync-'))
const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()
await app.listen({ port: 0, host: '127.0.0.1' })
const addr = app.server.address()
const port = typeof addr === 'object' && addr ? addr.port : 0

// Node 22 ships a global WebSocket — no need to import the 'ws' package.
const received = []
const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
await new Promise((res) => { sock.onopen = () => res() })
sock.onmessage = (ev) => { try { received.push(JSON.parse(String(ev.data))) } catch { /* ignore */ } }
sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph'] }))
await delay(60)

// External actor mutates the graph via the same backend the UI is connected to.
await app.inject({ method: 'POST', url: '/api/v1/batch', payload: { ops: [
  { type: 'createNode', nodeId: 'live1', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 1 } },
] } })
await delay(150)
sock.close()

const graphEvents = received.filter((m) => m.event === 'runtime')
if (graphEvents.length === 0) {
  console.error('NO graph event forwarded over /ws — live-sync broken. received:', received)
  await app.close(); process.exit(1)
}
await app.close()
rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
console.log(`[smoke-livesync] OK — graph mutation forwarded over /ws (${graphEvents.length} event(s)) → canvas refetches live`)
