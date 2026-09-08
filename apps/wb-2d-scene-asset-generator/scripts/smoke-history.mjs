// Proves the History-panel bridge contract end-to-end on the backend:
//   a PROGRAMMATIC batch (actor 'ai:test', POST /api/v1/batch) is persisted to
//   the kernel history.jsonl with its actor + ops + optional label, announced
//   over /ws as graph:applied (carrying the batchId), and is therefore
//   bridgeable into the editor's visible History panel — while a LOCAL editor
//   batch is intentionally skipped by the bridge (no double-recording).
//
// Isolated: temp FORGEAX_PROJECT_ROOT + an ALT port (never touches :9567).
// The browser store/DOM is unit-tested in node-runtime-react/historyBridge.test;
// here we assert the backend half + reproduce the bridge's label derivation.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const PORT = Number(process.env.SMOKE_HISTORY_PORT ?? 9577)

// ── Mirror of the node-runtime-react history bridge predicates ──────────────
const LOCAL_HISTORY_ACTORS = new Set(['editor', 'local'])
const isLocalHistoryActor = (actor) => LOCAL_HISTORY_ACTORS.has(actor)
const historyActorTag = (actor) =>
  actor.startsWith('ai') ? 'AI' : actor.startsWith('cli') ? 'CLI' : actor
const summarizeBatchOps = (ops) => {
  const counts = new Map()
  for (const op of ops) {
    const t = typeof op.type === 'string' ? op.type : 'op'
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return (
    Array.from(counts.entries())
      .map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
      .join(', ') || 'no-op'
  )
}
const bridgeLabel = (entry) =>
  entry.label ?? `${historyActorTag(entry.actor)}: ${summarizeBatchOps(entry.ops)}`

function fail(msg, extra) {
  console.error(`[smoke-history] FAIL — ${msg}`, extra ?? '')
  process.exitCode = 1
}

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-history-'))
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

try {
  // ── 1. PROGRAMMATIC (AI) batch: actor + label forwarded into history ──────
  const aiOps = [
    { type: 'createNode', nodeId: 'ai-a', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 1 } },
    { type: 'createNode', nodeId: 'ai-b', opId: 'relu', position: { x: 1, y: 1 }, params: { value: 2 } },
    { type: 'connect', edgeId: 'ai-e', source: { nodeId: 'ai-a', port: 'out' }, target: { nodeId: 'ai-b', port: 'in' } },
  ]
  const postRes = await fetch(`${base}/api/v1/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ops: aiOps, opts: { actor: 'ai:test', label: 'AI: scene smoke build' } }),
  })
  const applyResult = await postRes.json()
  if (applyResult.status !== 'ok') fail('AI batch was not applied', applyResult)
  await delay(150)

  // graph:applied forwarded over /ws with the committed batchId.
  const events = received.filter((m) => m.event === 'runtime' && m.payload?.kind === 'graph:applied')
  if (events.length === 0) fail('no graph:applied forwarded over /ws')
  const wsBatchId = events.at(-1)?.payload?.batchId
  if (!wsBatchId) fail('graph:applied carried no batchId — bridge cannot identify the batch')

  // The bridge looks the batch up in the kernel history by batchId.
  const history = await (await fetch(`${base}/api/v1/history`)).json()
  const entry = history.find((e) => e.batchId === wsBatchId)
  if (!entry) fail('committed batch missing from GET /api/v1/history', { wsBatchId })
  else {
    if (entry.actor !== 'ai:test') fail('history entry actor mismatch', entry.actor)
    if (entry.label !== 'AI: scene smoke build') fail('history entry label not persisted', entry.label)
    if (!Array.isArray(entry.ops) || entry.ops.length !== 3) fail('history entry ops mismatch', entry.ops)
    if (isLocalHistoryActor(entry.actor)) fail('AI actor wrongly classified as local (would be skipped)')
    const label = bridgeLabel(entry)
    if (label !== 'AI: scene smoke build') fail('bridge label derivation mismatch', label)
    console.log(`[smoke-history] AI batch → panel row: "${label}" (actor=${entry.actor}, batchId=${wsBatchId.slice(0, 8)}…)`)
  }

  // ── 2. LOCAL editor batch: bridge must SKIP it (no double-recording) ──────
  const localRes = await fetch(`${base}/api/v1/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ops: [{ type: 'createNode', nodeId: 'local-x', opId: 'relu', position: { x: 2, y: 2 }, params: {} }],
      opts: { actor: 'editor' },
    }),
  })
  const localResult = await localRes.json()
  await delay(120)
  const localHistory = await (await fetch(`${base}/api/v1/history`)).json()
  const localEntry = localHistory.find((e) => e.actor === 'editor')
  if (localResult.status === 'ok' && !localEntry) fail('local editor batch missing from history')
  if (localEntry && !isLocalHistoryActor(localEntry.actor)) fail('local editor actor not classified as local')
  if (localEntry) console.log('[smoke-history] local editor batch → bridge SKIPS (canvas hook already records it)')
} finally {
  sock.close()
  await app.close()
  rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
}

if (process.exitCode) {
  console.error('[smoke-history] one or more assertions failed')
} else {
  console.log('[smoke-history] OK — AI/CLI batch is history-bridgeable (actor+label+ops+batchId), local op skipped')
}
