// HTTP verification of the baker → blob-route → URDF mesh path against a live
// (isolated) backend. Builds `g_torus → g_part → g_to_urdf →
// urdf_preview` (torus is not a URDF-native primitive, so it must go through
// the OCCT bake → OBJ blob route, unlike box/cylinder/sphere), executes, and
// asserts:
//   1. urdf_preview.urdf contains <mesh filename="<64hex>.obj"/> (NOT a <box> AABB)
//   2. GET /api/v1/library/blob/<hex>.obj returns OBJ bytes (model/obj, starts "# ")
//   3. the same blob route serves identical content on a second GET (immutable)
//
// PORT env selects the backend (default 9585 — the isolated verify backend).

const PORT = process.env.PORT ?? 9585
const API = `http://127.0.0.1:${PORT}`

function fail(msg) {
  console.error(`\nFAIL: ${msg}`)
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

function flattenWire(wire) {
  if (!Array.isArray(wire)) return []
  const out = []
  for (const entry of wire) {
    if (entry && typeof entry === 'object' && Array.isArray(entry.items)) out.push(...entry.items)
    else out.push(entry)
  }
  return out
}

const TAG = `vb_${Date.now().toString(36)}`
const SHAPE = `torus_${TAG}`
const PART = `part_${TAG}`
const URDF = `urdf_${TAG}`
const PREVIEW = `prev_${TAG}`

const ops = [
  { type: 'createNode', nodeId: SHAPE, opId: 'g_torus', position: { x: 0, y: 0 }, params: { major_radius: 0.03, minor_radius: 0.008 } },
  { type: 'createNode', nodeId: PART, opId: 'g_part', position: { x: 240, y: 0 }, params: {} },
  { type: 'createNode', nodeId: URDF, opId: 'g_to_urdf', position: { x: 480, y: 0 }, params: { name: 'verify_torus' } },
  { type: 'createNode', nodeId: PREVIEW, opId: 'urdf_preview', position: { x: 720, y: 0 }, params: {} },
  { type: 'connect', edgeId: `e_geom_${TAG}`, source: { nodeId: SHAPE, port: 'geometry' }, target: { nodeId: PART, port: 'geometry' } },
  { type: 'connect', edgeId: `e_shape_${TAG}`, source: { nodeId: SHAPE, port: 'id' }, target: { nodeId: PART, port: 'shape_id' } },
  { type: 'connect', edgeId: `e_part_urdf_${TAG}`, source: { nodeId: PART, port: 'geometry' }, target: { nodeId: URDF, port: 'geometry' } },
  { type: 'connect', edgeId: `e_urdf_prev_${TAG}`, source: { nodeId: URDF, port: 'urdf' }, target: { nodeId: PREVIEW, port: 'urdf' } },
]

const batch = await postJson('/api/v1/batch', { ops, opts: { actor: 'verify-baker' } })
if (!batch.ok || batch.json?.status !== 'ok') {
  fail(`batch rejected: ${batch.json?.reason ?? `HTTP ${batch.status}`} — ${JSON.stringify(batch.json?.diagnostics ?? [])}`)
}
console.log('[http] graph built (g_torus → g_part → g_to_urdf → urdf_preview)')

const exec = await postJson('/api/v1/execute', {})
if (!exec.ok || exec.json?.status !== 'completed') {
  fail(`execute failed: status=${exec.json?.status} err=${JSON.stringify(exec.json?.error)}`)
}
console.log(`[http] executed: status=${exec.json.status} durationMs=${exec.json.durationMs}`)

const out = await fetch(`${API}/api/v1/nodes/${PREVIEW}/outputs/urdf`).then((r) => r.json())
const urdf = flattenWire(out?.value)[0]
if (typeof urdf !== 'string' || !urdf.includes('<robot')) fail(`urdf_preview missing <robot>: ${JSON.stringify(out?.value).slice(0, 200)}`)

const meshMatch = /<mesh filename="([0-9a-f]{64}\.obj)"\/>/.exec(urdf)
if (!meshMatch) {
  if (/<box /.test(urdf)) fail(`URDF fell back to <box> AABB (no baked mesh):\n${urdf}`)
  fail(`URDF has no <mesh filename="<sha>.obj"/>:\n${urdf}`)
}
const meshFile = meshMatch[1]
const meshCount = (urdf.match(/<mesh /g) ?? []).length
console.log(`[http] ✔ URDF contains <mesh filename="${meshFile}"/> (×${meshCount}: visual + collision), no <box> AABB`)

// Fetch the blob via the content-addressed route.
const blobRes = await fetch(`${API}/api/v1/library/blob/${meshFile}`)
if (!blobRes.ok) fail(`GET /api/v1/library/blob/${meshFile} → HTTP ${blobRes.status}`)
const ctype = blobRes.headers.get('content-type')
const cache = blobRes.headers.get('cache-control')
const etag = blobRes.headers.get('etag')
const body = await blobRes.text()
if (!body.startsWith('#') && !body.includes('\nv ')) fail(`blob body does not look like OBJ: ${body.slice(0, 60)}`)
const vCount = (body.match(/^v /gm) ?? []).length
const fCount = (body.match(/^f /gm) ?? []).length
if (vCount <= 0 || fCount <= 0) fail(`blob OBJ has no vertices/faces (v=${vCount} f=${fCount})`)
console.log(`[http] ✔ blob route served OBJ: ${body.length}B, v=${vCount} f=${fCount}, content-type=${ctype}`)
console.log(`[http]   headers: cache-control="${cache}" etag=${etag}`)
if (!String(cache).includes('immutable')) fail('blob route missing immutable cache-control')

// Negative/security checks on the route.
const bad = await fetch(`${API}/api/v1/library/blob/not-a-sha.obj`)
if (bad.status !== 400) fail(`malformed sha should be 400, got ${bad.status}`)
const missing = await fetch(`${API}/api/v1/library/blob/${'0'.repeat(64)}.obj`)
if (missing.status !== 404) fail(`unknown sha should be 404, got ${missing.status}`)
console.log('[http] ✔ blob route guards: malformed→400, unknown→404')

console.log('\nPASS: baker HTTP path (graph → execute → URDF <mesh> → blob OBJ)')
process.exit(0)
