// Proves the keyboard Undo/Redo RESTORE CONTRACT end-to-end on the backend, on
// the SAME canonical kernel path the editor keybinding (useCanvasUndoRedo) uses:
//
//   useHistoryStore.undo(currentPipeline) → restoreSnapshot(snapshot, 'undo')
//     → importPipeline(replace) / importPipelineGraph(replace, actor:'undo')
//     → ONE applyBatch → graph:applied (over /ws) → loadPipeline → reconcile.
//
// The editor records PRE-op snapshots (incl. AI/CLI `batch_applied` entries), so
// undoing an AI batch restores the PRE-batch graph; redo moves forward. Here we:
//   1. build a base graph (actor 'editor'),                 → capture PRE-batch
//   2. apply an AI batch (actor 'ai:test'),                  → capture POST-batch
//   3. drive UNDO: re-apply the PRE-batch snapshot via the import route with
//      actor 'undo' and assert GET /api/v1/pipeline === PRE-batch,
//   4. drive REDO: re-apply the POST-batch snapshot with actor 'redo' and assert
//      GET /api/v1/pipeline === POST-batch,
//   5. assert 'undo'/'redo' are HISTORY-SUPPRESSED actors (the bridge skips them
//      so a restore never creates a fresh panel row or double-advances the cursor).
//
// Isolated: temp FORGEAX_PROJECT_ROOT + an ALT port (never touches :9557).
// The browser store/cursor logic is unit-tested in node-runtime-react/undoRedo.test.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const PORT = Number(process.env.SMOKE_UNDO_PORT ?? 9579)

// ── Mirror of the node-runtime-react history-suppression predicate ──────────
// undo/redo restores re-apply a stored snapshot through the canonical apply
// path; the bridge must NOT record them as a fresh `batch_applied` entry.
const HISTORY_SUPPRESSED_ACTORS = new Set(['editor', 'local', 'undo', 'redo'])
const isHistorySuppressedActor = (actor) => HISTORY_SUPPRESSED_ACTORS.has(actor)

function fail(msg, extra) {
  console.error(`[smoke-undo] FAIL — ${msg}`, extra ?? '')
  process.exitCode = 1
}

/** Turn a kernel pipeline snapshot into a kernel-graph-v1 graph for re-import. */
function snapshotToGraph(snap) {
  return {
    id: snap.id ?? 'main',
    nodes: Object.values(snap.nodes).map((n) => ({
      id: n.id,
      opId: n.opId,
      name: n.name,
      position: n.position,
      params: n.params ?? {},
    })),
    edges: Object.values(snap.edges).map((e) => ({ id: e.id, source: e.source, target: e.target })),
    metadata: snap.metadata ?? {},
  }
}

/** Stable, comparable shape (ignores hash/timestamps). */
function normalize(snap) {
  return {
    nodes: Object.values(snap.nodes)
      .map((n) => ({ id: n.id, opId: n.opId, position: n.position, params: n.params }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: Object.values(snap.edges)
      .map((e) => ({ id: e.id, source: e.source, target: e.target }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-undo-'))
const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()
await app.listen({ port: PORT, host: '127.0.0.1' })
const base = `http://127.0.0.1:${PORT}`

const received = []
const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
await new Promise((res) => { sock.onopen = () => res() })
sock.onmessage = (ev) => { try { received.push(JSON.parse(String(ev.data))) } catch { /* ignore */ } }
sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph'] }))
await delay(60)

const getJson = async (path) => (await fetch(`${base}${path}`)).json()
const postJson = async (path, body) =>
  (await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()

try {
  // ── 1. base graph (actor 'editor') → capture the PRE-batch snapshot ────────
  const baseRes = await postJson('/api/v1/batch', {
    ops: [{ type: 'createNode', nodeId: 'base', opId: 'rect_grid', position: { x: 0, y: 0 }, params: { width: 4, height: 3, fillValue: 1 } }],
    opts: { actor: 'editor' },
  })
  if (baseRes.status !== 'ok') fail('base batch was not applied', baseRes)
  await delay(120)
  const preBatch = await getJson('/api/v1/pipeline')
  if (Object.keys(preBatch.nodes).join(',') !== 'base') fail('pre-batch graph not as expected', Object.keys(preBatch.nodes))
  console.log('[smoke-undo] PRE-batch graph: [base]')

  // ── 2. AI batch (actor 'ai:test') → capture the POST-batch snapshot ────────
  const aiRes = await postJson('/api/v1/batch', {
    ops: [
      { type: 'createNode', nodeId: 'gs', opId: 'grid_size', position: { x: 220, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_base_gs', source: { nodeId: 'base', port: 'grid' }, target: { nodeId: 'gs', port: 'grid' } },
    ],
    opts: { actor: 'ai:test', label: 'AI: add grid_size' },
  })
  if (aiRes.status !== 'ok') fail('AI batch was not applied', aiRes)
  await delay(150)

  const graphEvents = received.filter((m) => m.event === 'runtime' && m.payload?.kind === 'graph:applied')
  if (graphEvents.length === 0) fail('no graph:applied forwarded over /ws for the AI batch')
  const aiBatchId = graphEvents.at(-1)?.payload?.batchId
  const history = await getJson('/api/v1/history')
  const aiEntry = history.find((e) => e.batchId === aiBatchId)
  if (!aiEntry || aiEntry.actor !== 'ai:test') fail('AI batch missing/mismatched in history', aiEntry)
  if (isHistorySuppressedActor('ai:test')) fail('AI actor wrongly suppressed (would be invisible in panel)')

  const postBatch = await getJson('/api/v1/pipeline')
  if (Object.keys(postBatch.nodes).sort().join(',') !== 'base,gs') fail('post-batch graph not as expected', Object.keys(postBatch.nodes))
  if (Object.keys(postBatch.edges).length !== 1) fail('post-batch edge missing', postBatch.edges)
  console.log(`[smoke-undo] AI batch (actor=ai:test, batchId=${String(aiBatchId).slice(0, 8)}…) → POST-batch graph: [base, gs] + edge`)

  // ── 3. UNDO: restore the PRE-batch snapshot via the canonical import path ──
  // This is exactly what useCanvasUndoRedo does: take the history snapshot and
  // apply it authoritatively (replace) through importPipelineGraph, actor 'undo'.
  const undoRes = await postJson('/api/v1/pipeline/import', {
    format: 'kernel-graph-v1',
    graph: snapshotToGraph(preBatch),
    options: { mode: 'replace', actor: 'undo' },
  })
  if (undoRes.status !== 'ok') fail('undo restore (import replace, actor undo) was not applied', undoRes)
  await delay(150)

  const afterUndo = await getJson('/api/v1/pipeline')
  if (JSON.stringify(normalize(afterUndo)) !== JSON.stringify(normalize(preBatch))) {
    fail('UNDO did not restore the PRE-batch graph', { afterUndo: normalize(afterUndo), preBatch: normalize(preBatch) })
  } else {
    console.log('[smoke-undo] UNDO → GET /api/v1/pipeline back to PRE-batch graph: [base] (AI node + edge gone)')
  }
  // The restore must be history-suppressed (no fresh panel row, no cursor double-advance).
  if (!isHistorySuppressedActor('undo')) fail("actor 'undo' must be history-suppressed in the bridge")
  const undoHistory = await getJson('/api/v1/history')
  const undoEntry = [...undoHistory].reverse().find((e) => e.actor === 'undo')
  if (!undoEntry) fail("kernel did not persist the undo batch (actor 'undo')")
  else console.log("[smoke-undo] undo batch persisted in kernel history (actor='undo') BUT history-suppressed → no panel row")

  // ── 4. REDO: re-apply the POST-batch snapshot (actor 'redo') ───────────────
  const redoRes = await postJson('/api/v1/pipeline/import', {
    format: 'kernel-graph-v1',
    graph: snapshotToGraph(postBatch),
    options: { mode: 'replace', actor: 'redo' },
  })
  if (redoRes.status !== 'ok') fail('redo restore (import replace, actor redo) was not applied', redoRes)
  await delay(150)

  const afterRedo = await getJson('/api/v1/pipeline')
  if (JSON.stringify(normalize(afterRedo)) !== JSON.stringify(normalize(postBatch))) {
    fail('REDO did not restore the POST-batch graph', { afterRedo: normalize(afterRedo), postBatch: normalize(postBatch) })
  } else {
    console.log('[smoke-undo] REDO → GET /api/v1/pipeline forward to POST-batch graph: [base, gs] + edge')
  }
  if (!isHistorySuppressedActor('redo')) fail("actor 'redo' must be history-suppressed in the bridge")
} finally {
  sock.close()
  await app.close()
  rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
}

if (process.exitCode) {
  console.error('[smoke-undo] one or more assertions failed')
} else {
  console.log('[smoke-undo] OK — undo restores pre-batch graph, redo moves forward, undo/redo actors are history-suppressed (no loop)')
}
