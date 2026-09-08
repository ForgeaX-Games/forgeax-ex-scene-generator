// Proves the faithful "import a node-connection graph from a file" feature
// end-to-end on the backend, on the SAME kernel-batch path every other actor
// uses:
//   1. A saved template (kernel-graph-v1) is POSTed to /api/v1/pipeline/import
//      in replace mode with executeAfter:'full'.
//   2. The kernel importPipelineGraph applies it as ONE batch → graph:applied
//      is forwarded over /ws (canvas would refetch live) → history records the
//      import actor → executeNode runs the whole graph (previews produced).
//   3. We assert GET /api/v1/pipeline reflects the imported nodes/edges, a
//      History entry (actor:'import') exists, and node outputs were produced.
//   4. Round-trip: export the current graph → re-import → identical graph.
//   5. LLM/headless path: an inline replace import (actor 'ai:import',
//      executeAfter full) lands + is history-bridgeable.
//
// Isolated: temp FORGEAX_PROJECT_ROOT + an ALT port (never touches :9567).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const PORT = Number(process.env.SMOKE_IMPORT_PORT ?? 9575)

function fail(msg, extra) {
  console.error(`[smoke-import] FAIL — ${msg}`, extra ?? '')
  process.exitCode = 1
}

const root = mkdtempSync(join(tmpdir(), 'wb-scene-import-'))
process.env.FORGEAX_PROJECT_ROOT = root

// A saved template: rect_grid (params drive width/height/fill) → grid_size.
// Both are real scene-gen batteries, so a full run produces outputs.
const template = {
  format: 'kernel-graph-v1',
  name: 'Smoke Terrain',
  graph: {
    id: 'main',
    nodes: [
      { id: 'rg', opId: 'rect_grid', name: 'Rect Grid', position: { x: 0, y: 0 }, params: { width: 4, height: 3, fillValue: 1 } },
      { id: 'gs', opId: 'grid_size', name: 'Grid Size', position: { x: 220, y: 0 }, params: {} },
    ],
    edges: [{ id: 'e_rg_gs', source: { nodeId: 'rg', port: 'grid' }, target: { nodeId: 'gs', port: 'grid' } }],
    metadata: { viewport: { x: 12, y: 34, zoom: 1.25 } },
  },
}
mkdirSync(join(root, 'templates'), { recursive: true })
writeFileSync(join(root, 'templates', 'smoke-terrain.json'), JSON.stringify(template, null, 2))

const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()
await app.listen({ port: PORT, host: '127.0.0.1' })
const base = `http://127.0.0.1:${PORT}`

const received = []
const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
await new Promise((res) => { sock.onopen = () => res() })
sock.onmessage = (ev) => { try { received.push(JSON.parse(String(ev.data))) } catch { /* ignore */ } }
sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution'] }))
await delay(60)

const getJson = async (path) => (await fetch(`${base}${path}`)).json()
const postJson = async (path, body) =>
  (await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()

try {
  // ── 0. templates listing discovers the saved file ──────────────────────────
  const templates = await getJson('/api/v1/pipeline/templates')
  if (!Array.isArray(templates) || !templates.some((t) => t.path === 'smoke-terrain.json')) {
    fail('GET /api/v1/pipeline/templates did not list the saved template', templates)
  }

  // ── 1. import the template FILE (replace + execute full) ───────────────────
  const importRes = await postJson('/api/v1/pipeline/import', {
    file: { path: 'smoke-terrain.json' },
    options: { mode: 'replace', executeAfter: 'full' },
  })
  if (importRes.status !== 'ok') fail('file import was not applied', importRes)
  if (!importRes.executed) fail('file import did not execute (executeAfter:full)', importRes)
  await delay(200)

  // graph:applied forwarded over /ws (canvas refetches live).
  const graphEvents = received.filter((m) => m.event === 'runtime' && m.payload?.kind === 'graph:applied')
  if (graphEvents.length === 0) fail('no graph:applied forwarded over /ws after import')

  // ── 2. GET /api/v1/pipeline reflects the imported nodes/edges ──────────────
  const snap = await getJson('/api/v1/pipeline')
  const nodeIds = Object.keys(snap.nodes).sort()
  if (nodeIds.join(',') !== 'gs,rg') fail('imported nodes not reflected in pipeline', nodeIds)
  if (Object.keys(snap.edges).length !== 1) fail('imported edge not reflected', snap.edges)
  if (snap.nodes.rg?.name !== 'Rect Grid') fail('node name not round-tripped', snap.nodes.rg)
  if (JSON.stringify(snap.metadata?.viewport) !== JSON.stringify({ x: 12, y: 34, zoom: 1.25 })) {
    fail('viewport metadata not round-tripped', snap.metadata)
  }

  // ── 3. a History entry with the import actor exists ────────────────────────
  const history = await getJson('/api/v1/history')
  const importEntry = [...history].reverse().find((e) => e.actor === 'import')
  if (!importEntry) fail("no history entry with actor 'import'", history.map((e) => e.actor))
  else console.log(`[smoke-import] history entry actor='import' batchId=${importEntry.batchId.slice(0, 8)}…`)

  // ── 4. outputs were produced (preview reflects the imported graph) ─────────
  const rgOut = await getJson('/api/v1/nodes/rg/outputs/grid')
  const gsW = await getJson('/api/v1/nodes/gs/outputs/width')
  if (rgOut.value === undefined || rgOut.value === null) fail('rect_grid produced no grid output', rgOut)
  if (gsW.value === undefined || gsW.value === null) fail('grid_size produced no width output', gsW)
  else console.log('[smoke-import] outputs produced: rect_grid.grid + grid_size.width')

  // ── 5. round-trip: export current → re-import → identical graph ────────────
  const exportRes = await postJson('/api/v1/pipeline/export', { name: 'roundtrip' })
  if (!exportRes.path) fail('export did not return a file path', exportRes)
  const before = normalize(snap)
  await postJson('/api/v1/pipeline/import', { file: { path: exportRes.path }, options: { mode: 'replace' } })
  await delay(120)
  const after = normalize(await getJson('/api/v1/pipeline'))
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('round-trip graph not identical', { before, after })
  else console.log('[smoke-import] round-trip identical (export → re-import)')

  // ── 6. LLM/headless inline import (actor ai:import, execute full) ──────────
  const aiRes = await postJson('/api/v1/pipeline/import', {
    format: 'kernel-graph-v1',
    graph: {
      nodes: [{ id: 'only', opId: 'rect_grid', name: 'AI Grid', position: { x: 0, y: 0 }, params: { width: 2, height: 2, fillValue: 1 } }],
      edges: [],
    },
    options: { mode: 'replace', executeAfter: 'full', actor: 'ai:import', label: 'Import template scene' },
  })
  if (aiRes.status !== 'ok') fail('inline AI import was not applied', aiRes)
  await delay(150)
  const aiHistory = await getJson('/api/v1/history')
  const aiEntry = [...aiHistory].reverse().find((e) => e.actor === 'ai:import')
  if (!aiEntry) fail("no history entry with actor 'ai:import'", aiHistory.map((e) => e.actor))
  if (aiEntry && aiEntry.label !== 'Import template scene') fail('ai:import label not persisted', aiEntry.label)
  const aiSnap = await getJson('/api/v1/pipeline')
  if (Object.keys(aiSnap.nodes).join(',') !== 'only') fail('inline replace import did not swap the graph', Object.keys(aiSnap.nodes))
  else console.log("[smoke-import] inline AI import OK (actor='ai:import', replace, execute full)")
} finally {
  sock.close()
  await app.close()
  rmSync(root, { recursive: true, force: true })
}

function normalize(snap) {
  return {
    nodes: Object.values(snap.nodes)
      .map((n) => ({ id: n.id, opId: n.opId, name: n.name, position: n.position, params: n.params }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: Object.values(snap.edges)
      .map((e) => ({ id: e.id, source: e.source, target: e.target }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    viewport: snap.metadata?.viewport ?? null,
  }
}

if (process.exitCode) {
  console.error('[smoke-import] one or more assertions failed')
} else {
  console.log('[smoke-import] OK — template imported headlessly → graph + history + preview; round-trip identical; LLM path works')
}
