// E2E: prove a node DRAG (layout-only updateNode position) drives ZERO
// graph:applied frames, while a STRUCTURAL batch drives exactly ONE. Run
// against a live backend (PORT env). Uses Node 22 global fetch + WebSocket.
const PORT = process.env.PORT || '9555'
const BASE = `http://127.0.0.1:${PORT}`
const WS = `ws://127.0.0.1:${PORT}/ws`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

let graphApplied = 0
const frames = []

const sock = new WebSocket(WS)
await new Promise((resolve, reject) => {
  sock.onopen = resolve
  sock.onerror = (e) => reject(new Error('ws error: ' + (e?.message ?? 'unknown')))
  setTimeout(() => reject(new Error('ws open timeout')), 5000)
})
sock.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data)
    if (msg?.event === 'runtime' && msg?.payload?.kind === 'graph:applied') {
      graphApplied += 1
      frames.push(msg.payload.batchId)
    }
  } catch { /* ignore non-JSON */ }
}
// Bind to the graph channel (the backend only fans out after a subscribe).
sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph'] }))
await sleep(300)

// 1) STRUCTURAL: create a node -> expect exactly ONE graph:applied
const nodeId = `e2e_${Date.now()}`
await post('/api/v1/batch', {
  ops: [{ type: 'createNode', nodeId, opId: 'relu', position: { x: 0, y: 0 }, params: {} }],
})
await sleep(400)
const afterCreate = graphApplied

// 2) DRAG STORM: 25 layout-only updateNode position batches -> expect ZERO more
for (let i = 0; i < 25; i++) {
  await post('/api/v1/batch', {
    ops: [{ type: 'updateNode', nodeId, position: { x: i * 10, y: i * 5 } }],
  })
}
await sleep(600)
const afterDrag = graphApplied

// 3) STRUCTURAL again: a param change -> expect exactly ONE more
await post('/api/v1/batch', {
  ops: [{ type: 'updateNode', nodeId, params: { foo: 1 } }],
})
await sleep(400)
const afterParam = graphApplied

sock.close()

console.log(`[e2e] graph:applied after createNode      = ${afterCreate} (expect 1)`)
console.log(`[e2e] graph:applied after 25 drag batches = ${afterDrag} (expect 1 — no storm)`)
console.log(`[e2e] graph:applied after param change     = ${afterParam} (expect 2)`)
console.log(`[e2e] frames batchIds = ${JSON.stringify(frames)}`)

const ok = afterCreate === 1 && afterDrag === 1 && afterParam === 2
console.log(ok ? '[e2e] PASS — drags produced no graph:applied storm' : '[e2e] FAIL')
process.exit(ok ? 0 : 1)
