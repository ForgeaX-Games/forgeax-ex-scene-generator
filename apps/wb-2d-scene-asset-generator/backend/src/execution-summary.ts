// Agent-facing projection of a pipeline ExecutionResult.
//
// The REST route /api/v1/execute (routes/execute.ts) returns the FULL
// ExecutionResult — every node/port carries its DataTreeEntry[] wire value. For
// the 2D asset app a port can hold image payloads (data URIs / base64) that are
// hundreds of KB each, so dumping a full execute into the model's context blows
// up the LLM window and the chat DOM.
//
// This module projects the full result into a KB-scale summary that keeps only
// what the agent needs to verify "did each node produce output":
//   - top-level status / error / durationMs (unchanged — success is judged on these)
//   - per node/port: branch & item counts + a lightweight per-item shape note
//     (never the raw pixels / data URIs).
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

// Cap how many items per port we inline, and how long a scalar string may be
// before it collapses to a shape note (image data URIs / base64 are huge).
const MAX_INLINE_ITEMS = 8
const MAX_STRING_CHARS = 256

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Summarize a single item inside a DataTreeEntry.items array (one wire payload). */
function summarizeItem(item: unknown): unknown {
  // Long strings (image data URIs, base64, big text) → shape note, never inlined.
  if (typeof item === 'string' && item.length > MAX_STRING_CHARS) {
    return { kind: 'string', length: item.length }
  }
  // Small scalars pass through unchanged (string/number/boolean/null).
  if (item === null || typeof item !== 'object') return item
  // Arrays (e.g. raw pixel rows) — never inline; just shape it.
  if (Array.isArray(item)) {
    return { kind: 'array', length: item.length }
  }
  // Object payload (e.g. an image record { base64, width, height }): report keys
  // and any small dimension scalars, but never the pixel string itself.
  const keys = Object.keys(item).slice(0, 32)
  const dims: Record<string, unknown> = {}
  for (const k of ['width', 'height', 'mimeType', 'alias', 'blobId', 'sizeBytes']) {
    const v = (item as Record<string, unknown>)[k]
    if ((typeof v === 'number' || typeof v === 'string') && String(v).length <= MAX_STRING_CHARS) dims[k] = v
  }
  return { kind: 'object', keys, ...dims }
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
