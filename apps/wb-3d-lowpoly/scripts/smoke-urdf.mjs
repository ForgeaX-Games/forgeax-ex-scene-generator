// Headless proof of a real geometry → URDF pipeline executing end-to-end over
// the HTTP API. Builds `g_box → g_part → g_to_urdf` via POST /api/v1/batch,
// executes the graph, then reads the g_to_urdf node's `urdf` output and asserts
// it is a non-empty `<robot>` XML string.
//
// The backend must already be listening on $PORT (default 9567, matching
// `bun run serve` / main.ts). Op shapes used here are the kernel's apply-batch
// vocabulary (createNode / connect); see
// external/.../node-runtime/src/layer2/apply-batch.ts.

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

// Recursively dig a string containing `<robot` out of any DataTree wrapping the
// kernel may apply to a string port's cached output value.
function findRobotString(value) {
  if (typeof value === 'string') return value.includes('<robot') ? value : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findRobotString(item)
      if (hit) return hit
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const hit = findRobotString(v)
      if (hit) return hit
    }
  }
  return null
}

// 1) Build the pipeline. g_box emits both a `geometry` and an `id` port; wire
//    geometry forward and feed box.id into g_part.shape_id so the part wraps the
//    box's emitted shape. g_part.geometry then flows into g_to_urdf.geometry.
const ops = [
  { type: 'createNode', nodeId: 'box', opId: 'g_box', position: { x: 0, y: 0 }, params: { w: 2, d: 1, h: 0.5 } },
  { type: 'createNode', nodeId: 'part', opId: 'g_part', position: { x: 240, y: 0 }, params: {} },
  { type: 'createNode', nodeId: 'urdf', opId: 'g_to_urdf', position: { x: 480, y: 0 }, params: { name: 'smoke_robot' } },
  { type: 'connect', edgeId: 'e_box_part_geom', source: { nodeId: 'box', port: 'geometry' }, target: { nodeId: 'part', port: 'geometry' } },
  { type: 'connect', edgeId: 'e_box_part_shape', source: { nodeId: 'box', port: 'id' }, target: { nodeId: 'part', port: 'shape_id' } },
  { type: 'connect', edgeId: 'e_part_urdf_geom', source: { nodeId: 'part', port: 'geometry' }, target: { nodeId: 'urdf', port: 'geometry' } },
]

const batch = await postJson('/api/v1/batch', { ops, opts: { actor: 'smoke-urdf' } })
if (!batch.ok) fail(`POST /api/v1/batch returned HTTP ${batch.status}`)
if (batch.json?.status !== 'ok') {
  fail(`batch rejected: ${batch.json?.reason ?? 'unknown'} — diagnostics: ${JSON.stringify(batch.json?.diagnostics ?? [])}`)
}

// 2) Execute the graph so outputs get computed.
const exec = await postJson('/api/v1/execute', {})
if (!exec.ok) fail(`POST /api/v1/execute returned HTTP ${exec.status}`)

// 3) Read the g_to_urdf node's `urdf` output.
const res = await fetch(`${API}/api/v1/nodes/urdf/outputs/urdf`)
if (!res.ok) fail(`GET outputs/urdf returned HTTP ${res.status}`)
const out = await res.json().catch(() => ({}))
const urdf = findRobotString(out?.value)

// 4) Assert non-empty `<robot>` URDF.
if (typeof urdf !== 'string' || urdf.length === 0) {
  fail(`urdf output missing or empty — raw value: ${JSON.stringify(out?.value)}`)
}
if (!urdf.includes('<robot')) {
  fail(`urdf does not contain <robot> — got: ${urdf.slice(0, 200)}`)
}

console.log(`PASS: URDF emitted (${urdf.length} chars)`)
console.log(urdf)
process.exit(0)
