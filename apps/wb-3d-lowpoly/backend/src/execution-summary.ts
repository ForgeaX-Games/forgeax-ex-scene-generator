// Agent-facing projection of a pipeline ExecutionResult.
//
// The REST route /api/v1/execute (routes/execute.ts) returns the FULL
// ExecutionResult — every node/port carries its DataTreeEntry[] wire value. For
// the lowpoly app a port can hold whole meshes (vertex/index/UV arrays) that are
// large, so dumping a full execute into the model's context blows up the LLM
// window and the chat DOM.
//
// This module projects the full result into a KB-scale summary that keeps only
// what the agent needs to verify "did each node produce output":
//   - top-level status / error / durationMs (unchanged — success is judged on these)
//   - per node/port: branch & item counts + a lightweight per-item shape note
//     (never the raw vertex / index / pixel arrays).
//
// The projection is defensive: any unexpected port shape collapses to a safe note
// instead of throwing, so one malformed port can never break the whole summary.

/** Mirrors layer2/execute-node.ts ExecutionResult (kept local to avoid a dep). */
export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'error' | 'aborted'
  outputs: Record<string, Record<string, unknown>>
  error?: { nodeId?: string; message: string }
  durationMs: number
}

// Cap how many items per port we inline, how long a scalar string may be
// before it collapses to a shape note (data URIs / base64 / serialized meshes),
// how many array elements get summarized element-by-element instead of just a
// length note, and how deep the recursive object walk goes.
const MAX_INLINE_ITEMS = 8
const MAX_STRING_CHARS = 4000
const MAX_ARRAY_INLINE = 20
const MAX_DEPTH = 4

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Long strings with no whitespace at all (data URIs, base64, hashes) are never
// something the agent should read as text — collapse those to a length-only
// shape note regardless of size. Human-readable text (QC reports, validation
// errors, diagnostics) is exactly what fix loops need to read, so it is kept
// verbatim up to a generous cap instead of nuked at 256 chars.
function isOpaqueBlob(s: string): boolean {
  if (s.startsWith('data:')) return true
  return s.length > 200 && !/\s/.test(s)
}

function summarizeString(s: string): unknown {
  if (isOpaqueBlob(s)) return { kind: 'string', length: s.length }
  if (s.length > MAX_STRING_CHARS) {
    return { kind: 'string', length: s.length, preview: s.slice(0, MAX_STRING_CHARS) }
  }
  return s
}

/**
 * Summarize an arbitrary value found inside a DataTreeEntry item, recursively
 * and depth-capped. This is the fix for a bug where structured QC/validation
 * output (e.g. g_geometry_qc's `report`/`signals`,
 * g_to_urdf's `report`/`diagnostics`) was destroyed by the summary: any array
 * (including a short `signals[]` list of {code, severity, message} objects)
 * collapsed to `{kind:'array', length}` with zero content, and any object
 * (including that report object itself) kept only a hardcoded mesh-record key
 * allowlist (name/vertexCount/.../sizeBytes) and dropped every other field —
 * so the AI calling the default `lowpoly:pipeline.execute` tool could never
 * actually read *what* QC found, only that something ran. Small/shallow
 * structures (QC signals, diagnostics, report objects) are now inlined field
 * by field; large/deep ones (mesh vertex/index buffers, big nested graphs)
 * still collapse to a shape note so the context never blows up.
 */
function summarizeValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return summarizeString(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || value.length > MAX_ARRAY_INLINE) {
      return { kind: 'array', length: value.length }
    }
    return value.map((v) => summarizeValue(v, depth + 1))
  }
  const keys = Object.keys(value).slice(0, 32)
  if (depth >= MAX_DEPTH) return { kind: 'object', keys }
  const out: Record<string, unknown> = { kind: 'object', keys }
  for (const k of keys) {
    out[k] = summarizeValue((value as Record<string, unknown>)[k], depth + 1)
  }
  return out
}

/** Summarize a single item inside a DataTreeEntry.items array (one wire payload). */
function summarizeItem(item: unknown): unknown {
  return summarizeValue(item, 0)
}

interface PortSummary {
  branchCount: number
  itemCount: number
  items: unknown[]
  truncated?: boolean
}

/** Summarize one port wire value (DataTreeEntry[] toJSON form). Never throws. */
function summarizePort(value: unknown): unknown {
  if (!Array.isArray(value)) {
    if (value === null || typeof value !== 'object') return { value }
    return { kind: 'object', keys: Object.keys(value as object).slice(0, 32) }
  }
  const summaries: unknown[] = []
  let itemCount = 0
  let truncated = false
  for (const entry of value) {
    const items = isRecord(entry) && Array.isArray(entry.items) ? entry.items : []
    itemCount += items.length
    for (const item of items) {
      if (summaries.length < MAX_INLINE_ITEMS) {
        const path = isRecord(entry) && Array.isArray(entry.path) ? entry.path : undefined
        const s = summarizeItem(item)
        summaries.push({ ...(path ? { path } : {}), ...(isRecord(s) ? s : { value: s }) })
      } else {
        truncated = true
      }
    }
  }
  const out: PortSummary = { branchCount: value.length, itemCount, items: summaries }
  if (truncated) out.truncated = true
  return out
}

/**
 * Project a full ExecutionResult into a KB-scale summary for the AI tool layer.
 * status / error / executionId / durationMs are preserved verbatim; `outputs` is
 * projected node-by-node, port-by-port into shape notes, never the raw payloads.
 */
export function summarizeExecutionResult(full: unknown): unknown {
  if (!isRecord(full)) return full
  const summarizedOutputs: Record<string, Record<string, unknown>> = {}
  const outputs = isRecord(full.outputs) ? full.outputs : {}
  for (const [nodeId, ports] of Object.entries(outputs)) {
    if (!isRecord(ports)) continue
    const portSummaries: Record<string, unknown> = {}
    for (const [portId, value] of Object.entries(ports)) {
      try {
        portSummaries[portId] = summarizePort(value)
      } catch {
        portSummaries[portId] = { error: 'summary failed for this port' }
      }
    }
    summarizedOutputs[nodeId] = portSummaries
  }
  return {
    executionId: full.executionId,
    status: full.status,
    durationMs: full.durationMs,
    ...(full.error !== undefined ? { error: full.error } : {}),
    summarized: true,
    outputs: summarizedOutputs,
  }
}
