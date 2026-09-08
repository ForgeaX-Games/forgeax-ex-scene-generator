// Headless proof of the LIVE-SYNC data path: the 3D viewer's `useViewer3DLiveSync`
// hook reads `urdf_preview.urdf` (falling back to `g_to_urdf.urdf`). This builds
// the full preview chain `g_box → g_part → g_to_urdf → urdf_preview` via
// POST /api/v1/batch, executes it, then asserts
// `GET /api/v1/nodes/<urdf_preview>/outputs/urdf` yields a `<robot>` XML string
// — i.e. exactly the bytes the hook would pull and feed into the viewer store.
//
// The backend must already be listening on $PORT (default 9567, matching
// `bun run serve` / main.ts). Op shapes are the kernel's apply-batch vocabulary
// (createNode / connect).

const PORT = process.env.PORT ?? 9567
const API = `http://127.0.0.1:${PORT}`

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

// `flattenWire` (frontend) unwraps one DataTree level: `[{path, items:[v]}]` → v.
// Mirror it here so this script asserts on the same shape the hook consumes,
// rather than a deep recursive dig.
function flattenWire(wire) {
  if (!Array.isArray(wire)) return []
  const out = []
  for (const entry of wire) {
    if (entry && typeof entry === 'object' && Array.isArray(entry.items)) out.push(...entry.items)
    else out.push(entry)
  }
  return out
}

// 1) Build g_box → g_part → g_to_urdf → urdf_preview. The first three mirror the
//    base smoke; the fourth wires g_to_urdf.urdf into urdf_preview.urdf so the
//    preview node carries the URDF the live-sync hook reads. IDs are suffixed
//    with a run tag so reruns don't collide with a persisted graph.
const RUN = `sp_${Date.now().toString(36)}`
const BOX = `box_${RUN}`
const PART = `part_${RUN}`
const URDF = `urdf_${RUN}`
const PREVIEW = `preview_${RUN}`
const ops = [
  { type: 'createNode', nodeId: BOX, opId: 'g_box', position: { x: 0, y: 0 }, params: { w: 2, d: 1, h: 0.5 } },
  { type: 'createNode', nodeId: PART, opId: 'g_part', position: { x: 240, y: 0 }, params: {} },
  { type: 'createNode', nodeId: URDF, opId: 'g_to_urdf', position: { x: 480, y: 0 }, params: { name: 'smoke_robot' } },
  { type: 'createNode', nodeId: PREVIEW, opId: 'urdf_preview', position: { x: 720, y: 0 }, params: {} },
  { type: 'connect', edgeId: `e_box_part_geom_${RUN}`, source: { nodeId: BOX, port: 'geometry' }, target: { nodeId: PART, port: 'geometry' } },
  { type: 'connect', edgeId: `e_box_part_shape_${RUN}`, source: { nodeId: BOX, port: 'id' }, target: { nodeId: PART, port: 'shape_id' } },
  { type: 'connect', edgeId: `e_part_urdf_geom_${RUN}`, source: { nodeId: PART, port: 'geometry' }, target: { nodeId: URDF, port: 'geometry' } },
  { type: 'connect', edgeId: `e_urdf_preview_${RUN}`, source: { nodeId: URDF, port: 'urdf' }, target: { nodeId: PREVIEW, port: 'urdf' } },
]

const batch = await postJson('/api/v1/batch', { ops, opts: { actor: 'smoke-urdf-preview' } })
if (!batch.ok) fail(`POST /api/v1/batch returned HTTP ${batch.status}`)
if (batch.json?.status !== 'ok') {
  fail(`batch rejected: ${batch.json?.reason ?? 'unknown'} — diagnostics: ${JSON.stringify(batch.json?.diagnostics ?? [])}`)
}

// 2) Execute the graph so outputs get computed.
const exec = await postJson('/api/v1/execute', {})
if (!exec.ok) fail(`POST /api/v1/execute returned HTTP ${exec.status}`)

// 3) Read the urdf_preview node's `urdf` output — the exact endpoint the hook
//    pulls — and flatten it the same way the frontend does.
const res = await fetch(`${API}/api/v1/nodes/${PREVIEW}/outputs/urdf`)
if (!res.ok) fail(`GET nodes/${PREVIEW}/outputs/urdf returned HTTP ${res.status}`)
const out = await res.json().catch(() => ({}))
const urdf = flattenWire(out?.value)[0]

// 4) Assert non-empty `<robot>` URDF at the urdf_preview node.
if (typeof urdf !== 'string' || urdf.length === 0) {
  fail(`urdf_preview output missing or empty — raw value: ${JSON.stringify(out?.value)}`)
}
if (!urdf.includes('<robot')) {
  fail(`urdf does not contain <robot> — got: ${urdf.slice(0, 200)}`)
}

console.log(`PASS: urdf_preview emitted URDF (${urdf.length} chars)`)
console.log(urdf.slice(0, 400))
process.exit(0)
