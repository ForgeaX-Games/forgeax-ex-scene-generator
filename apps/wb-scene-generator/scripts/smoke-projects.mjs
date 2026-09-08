// Proves KERNEL-LEVEL multi-project management end-to-end on the backend, on
// the same kernel storage the editor uses. Fully isolated: a temp
// FORGEAX_PROJECT_ROOT + an ALT port (never touches :9557).
//
//   PHASE 0  default-project backfill adopts an existing implicit
//            <root>/state/graph.json in place (current work survives).
//   PHASE 1  create 2 projects, give each a different graph, activate A then B
//            and assert GET /api/v1/pipeline reflects the active project's graph
//            each time; per-project history isolation; the 'main' graph survives.
//   PHASE 2  the AI/headless path: create a project → open it (graph loads +
//            graph:applied forwarded over /ws) → applyBatch (history scoped to
//            that project) → screenshot capture resolves.
//   PHASE 3  delete keeps the workspace non-empty + returns the new workspace.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createRuntime } from '@forgeax/node-runtime'

const PORT = Number(process.env.SMOKE_PROJECTS_PORT ?? 9579)

function fail(msg, extra) {
  console.error(`[smoke-projects] FAIL — ${msg}`, extra ?? '')
  process.exitCode = 1
}

const root = mkdtempSync(join(tmpdir(), 'wb-scene-projects-'))
process.env.FORGEAX_PROJECT_ROOT = root

// ── PHASE 0 prep: seed the legacy implicit pipeline at <root>/state/graph.json
// BEFORE the app starts. GraphStore.save writes a hash-valid file; the registry
// must adopt it as the default project on first init (no file moves).
const seedRt = createRuntime({ projectRoot: root, pipelineId: 'main', pluginId: '@forgeax-plugin/wb-scene-generator' })
const ts = new Date().toISOString()
seedRt.graph.save({
  schemaVersion: 1,
  id: 'main',
  createdAt: ts,
  updatedAt: ts,
  nodes: {
    seeded: { id: 'seeded', opId: 'rect_grid', name: 'Seeded', position: { x: 0, y: 0 }, params: { width: 2, height: 2, fillValue: 1 } },
  },
  edges: {},
})

// A template for fromTemplate seeding.
mkdirSync(join(root, 'templates'), { recursive: true })
writeFileSync(
  join(root, 'templates', 'tpl.json'),
  JSON.stringify({
    format: 'kernel-graph-v1',
    name: 'Template Scene',
    graph: {
      nodes: [{ id: 'tplNode', opId: 'rect_grid', name: 'Tpl Grid', position: { x: 10, y: 10 }, params: { width: 3, height: 3, fillValue: 1 } }],
      edges: [],
    },
  }),
)

const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()
await app.listen({ port: PORT, host: '127.0.0.1' })
const base = `http://127.0.0.1:${PORT}`

const getJson = async (path) => (await fetch(`${base}${path}`)).json()
const postJson = async (path, body) =>
  (await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json()
const delJson = async (path) => (await fetch(`${base}${path}`, { method: 'DELETE' })).json()

const createNodeOps = (nodeId) => ({
  ops: [{ type: 'createNode', nodeId, opId: 'rect_grid', position: { x: 0, y: 0 }, params: { width: 2, height: 2, fillValue: 1 } }],
})

// Editor-style live client (graph:applied refetch driver).
const received = []
const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
await new Promise((res) => { sock.onopen = () => res() })
sock.onmessage = (ev) => { try { received.push(JSON.parse(String(ev.data))) } catch { /* ignore */ } }
sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution'] }))
await delay(60)

// Fake renderer: resolves screenshot capture requests (proves the AI thumbnail path).
const renderer = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
await new Promise((res) => { renderer.onopen = () => res() })
renderer.onmessage = async (ev) => {
  let msg
  try { msg = JSON.parse(String(ev.data)) } catch { return }
  if (msg.event === 'screenshot:request') {
    await postJson('/api/v1/agent/screenshot/store', {
      captureId: msg.payload.captureId,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      width: 1,
      height: 1,
    })
  }
}
await delay(40)

try {
  // ── PHASE 0: default-project backfill adopts the existing implicit graph ──
  const ws0 = await getJson('/api/v1/workspace')
  if (ws0.activeProjectId !== 'main') fail("default backfill did not set active project 'main'", ws0)
  const projects0 = await getJson('/api/v1/projects')
  if (!Array.isArray(projects0) || !projects0.some((p) => p.id === 'main')) fail('default project not backfilled', projects0)
  const snap0 = await getJson('/api/v1/pipeline')
  if (!snap0.nodes?.seeded) fail('backfill did not adopt the existing <root>/state/graph.json (work lost!)', Object.keys(snap0.nodes ?? {}))
  else console.log("[smoke-projects] PHASE 0 OK — default project 'main' backfilled, existing graph preserved (node 'seeded')")

  // ── PHASE 1: create 2 projects with isolated graphs; activate swaps graph ──
  const a = await postJson('/api/v1/projects', { name: 'Project A', type: 'scene' })
  if (!a.id) fail('create Project A failed', a)
  const b = await postJson('/api/v1/projects', { name: 'Project B', type: 'scene', fromTemplate: 'tpl.json' })
  if (!b.id) fail('create Project B (fromTemplate) failed', b)

  // Activate A → empty graph; put aNode into it.
  const actA = await postJson(`/api/v1/projects/${a.id}/activate`)
  if (actA.project?.manifest?.id !== a.id) fail('activate A did not return the project', actA)
  let snap = await getJson('/api/v1/pipeline')
  if (Object.keys(snap.nodes).length !== 0) fail('new project A should start empty', Object.keys(snap.nodes))
  await postJson('/api/v1/batch', { ...createNodeOps('aNode'), opts: { actor: 'ai:test', label: 'A op' } })

  // Activate B → its template graph (NOT A's).
  await postJson(`/api/v1/projects/${b.id}/activate`)
  snap = await getJson('/api/v1/pipeline')
  if (Object.keys(snap.nodes).join(',') !== 'tplNode') fail('activate B did not reflect the template graph', Object.keys(snap.nodes))
  else console.log('[smoke-projects] PHASE 1 — activate B reflects fromTemplate graph (node tplNode)')

  // Activate A again → only aNode (isolation holds across switches).
  await postJson(`/api/v1/projects/${a.id}/activate`)
  snap = await getJson('/api/v1/pipeline')
  if (Object.keys(snap.nodes).join(',') !== 'aNode') fail('activate A did not reflect A-only graph', Object.keys(snap.nodes))
  // per-project history isolation: A's history has the 'A op' batch.
  const histA = await getJson('/api/v1/history')
  if (!histA.some((e) => e.label === 'A op')) fail("A's history missing its own batch", histA.map((e) => e.label))

  // Activate B → its history must NOT contain A's batch (per-project isolation).
  await postJson(`/api/v1/projects/${b.id}/activate`)
  const histB = await getJson('/api/v1/history')
  if (histB.some((e) => e.label === 'A op')) fail("B's history leaked A's batch (history NOT isolated)", histB.map((e) => e.label))
  else console.log('[smoke-projects] PHASE 1 — per-project history isolated (A op only in A)')

  // The 'main' project's original graph still survives a round of switching.
  await postJson('/api/v1/projects/main/activate')
  snap = await getJson('/api/v1/pipeline')
  if (!snap.nodes?.seeded) fail("'main' graph was clobbered by project switching", Object.keys(snap.nodes))
  else console.log("[smoke-projects] PHASE 1 OK — switching A↔B↔main reflected in API; 'main' graph intact")

  // graph:applied forwarded over /ws on activate (canvas/preview refetch live).
  const graphEvents = received.filter((m) => m.event === 'runtime' && m.payload?.kind === 'graph:applied')
  if (graphEvents.length === 0) fail('no graph:applied forwarded over /ws on activate')

  // ── PHASE 2: AI/headless path — create → open → batch → screenshot ────────
  const ai = await postJson('/api/v1/projects', { name: 'AI Project', type: 'scene' })
  await postJson(`/api/v1/projects/${ai.id}/activate`)
  await postJson('/api/v1/batch', { ...createNodeOps('aiNode'), opts: { actor: 'ai:agent', label: 'AI built a node' } })
  const aiSnap = await getJson('/api/v1/pipeline')
  if (!aiSnap.nodes?.aiNode) fail('AI batch did not land in the opened project', Object.keys(aiSnap.nodes))
  const aiHist = await getJson('/api/v1/history')
  if (!aiHist.some((e) => e.actor === 'ai:agent')) fail("AI batch not in the project's history", aiHist.map((e) => e.actor))
  const capture = await postJson('/api/v1/agent/screenshot/capture', { timeout: 4000 })
  if (!capture.dataUrl) fail('screenshot capture did not resolve (AI thumbnail path)', capture)
  else console.log('[smoke-projects] PHASE 2 OK — AI create→open→batch→screenshot capture works')

  // ── PHASE 3: delete keeps the workspace non-empty + returns it ─────────────
  const del = await delJson(`/api/v1/projects/${b.id}`)
  if (!del.ok) fail('delete B failed', del)
  if (!del.workspace?.activeProjectId) fail('delete left the workspace without an active project', del)
  const projectsFinal = await getJson('/api/v1/projects')
  if (projectsFinal.some((p) => p.id === b.id)) fail('deleted project still listed', projectsFinal.map((p) => p.id))
  else console.log('[smoke-projects] PHASE 3 OK — delete removed B; workspace stays non-empty')
} finally {
  sock.close()
  renderer.close()
  await app.close()
  rmSync(root, { recursive: true, force: true })
}

if (process.exitCode) {
  console.error('[smoke-projects] one or more assertions failed')
} else {
  console.log('[smoke-projects] OK — backfill + 2 isolated projects (graph+history) + activate switching in API + AI create/open/batch/screenshot + safe delete')
}
