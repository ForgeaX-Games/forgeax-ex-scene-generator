// Headless proof of the WS-coordinated screenshot CAPTURE PROTOCOL — without a
// browser or real pixels. It exercises the exact three-way handshake the live
// URDF viewer uses:
//
//   1. open a WebSocket to /ws (this is what `useScreenshotCapture` does)
//   2. concurrently POST /api/v1/agent/screenshot/capture (the agent/LLM side),
//      which broadcasts `screenshot:request{captureId}` and BLOCKS
//   3. when the socket receives that broadcast, POST a tiny VALID 1x1 PNG to
//      /api/v1/agent/screenshot/store with the same captureId (the renderer's job)
//
// We then assert the blocked /capture response is the stored record (matching
// captureId + dataUrl) AND that GET /latest returns the same record. This proves
// the protocol plumbing end-to-end; it deliberately does NOT prove real rendered
// pixels (see scripts/north-star-loop.mjs for the Playwright real-pixel loop).
//
// The backend must already be listening on $PORT (default 9567, matching
// `bun run serve` / main.ts). Node 22's global WebSocket is used, so there is no
// `ws` dependency.

const PORT = process.env.PORT ?? 9567
const API = `http://127.0.0.1:${PORT}`
const WS_URL = `ws://127.0.0.1:${PORT}/ws`

// Smallest valid 1x1 PNG (transparent). Decodes cleanly in any PNG reader.
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

// 1) Open the renderer-side socket and wait until it's live.
const ws = new WebSocket(WS_URL)
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('WS open timeout')), 5000)
  ws.addEventListener('open', () => { clearTimeout(t); resolve() }, { once: true })
  ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`WS error: ${e?.message ?? e}`)) }, { once: true })
}).catch((e) => fail(e.message))

// 2) When the broadcast arrives, the socket answers /store with a valid PNG.
//    Track the captureId we stored so we can cross-check the /capture body.
let storedCaptureId = null
const stored = new Promise((resolve) => {
  ws.addEventListener('message', async (ev) => {
    let msg
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()) } catch { return }
    if (msg?.event !== 'screenshot:request' || !msg.payload?.captureId) return
    storedCaptureId = msg.payload.captureId
    const r = await postJson('/api/v1/agent/screenshot/store', {
      captureId: storedCaptureId,
      dataUrl: PNG_1X1,
      width: 1,
      height: 1,
    })
    if (!r.ok || r.json?.ok !== true) fail(`/store rejected captureId=${storedCaptureId}: HTTP ${r.status} ${JSON.stringify(r.json)}`)
    resolve()
  })
})

// 3) Fire the blocking /capture; it resolves only after the socket stores.
const capture = postJson('/api/v1/agent/screenshot/capture', { timeout: 3000 })

await stored
const cap = await capture
if (!cap.ok) fail(`/capture returned HTTP ${cap.status}: ${JSON.stringify(cap.json)}`)

// 4) The agent-facing /capture body carries the stored captureId + a saved PNG
//    PATH — NOT the base64 dataUrl (that would dump KBs of text into the LLM
//    context; the agent views the image via read_file on `path` instead).
const rec = cap.json
if (rec?.captureId !== storedCaptureId) fail(`/capture captureId mismatch: got ${rec?.captureId}, stored ${storedCaptureId}`)
if (typeof rec?.path !== 'string' || !rec.path.endsWith('.png')) fail(`/capture missing PNG path: got ${JSON.stringify(rec?.path)}`)
if (rec?.dataUrl !== undefined) fail(`/capture must NOT inline dataUrl (got ${String(rec?.dataUrl).slice(0, 40)}…)`)
if (rec?.width !== 1 || rec?.height !== 1) fail(`/capture dims mismatch: ${rec?.width}x${rec?.height}`)

// 5) GET /latest must return the same captureId + a PNG path (no dataUrl).
const latestRes = await fetch(`${API}/api/v1/agent/screenshot/latest`)
if (!latestRes.ok) fail(`GET /latest returned HTTP ${latestRes.status}`)
const latest = await latestRes.json().catch(() => ({}))
if (latest?.captureId !== storedCaptureId) fail(`/latest captureId mismatch: got ${latest?.captureId}, stored ${storedCaptureId}`)
if (typeof latest?.path !== 'string' || !latest.path.endsWith('.png')) fail(`/latest missing PNG path: got ${JSON.stringify(latest?.path)}`)
if (latest?.dataUrl !== undefined) fail(`/latest must NOT inline dataUrl`)

ws.close()
console.log(`PASS: screenshot plumbing round-trip (captureId=${storedCaptureId}, 1x1 PNG via /capture + /latest)`)
process.exit(0)
