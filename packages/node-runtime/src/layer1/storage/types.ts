// Storage contracts. The kernel persists three artefacts per pipeline,
// each with strict invariants documented in
// docs/node-runtime-architecture/04-GRAPH-STATE.md:
//
//   graph.json           kernel execution projection, overwrite-write, hash-validated
//   history.jsonl        append-only operation log
//   outputs/<id>/<port>  execution cache (can be discarded)
//
// This layer intentionally does not define an authoring source of truth. A
// canonical Scene Project owns semantics in `.scene.ts`; graph.json is rebuilt
// from that project and remains authoritative only inside the runtime kernel.

import type { GraphEdge, GraphNode, NodeGroup } from '../types/graph.js'

/** On-disk shape of graph.json. */
export interface GraphFileV1 {
  schemaVersion: 1
  id: string
  createdAt: string
  updatedAt: string
  /** sha256 of the canonical-form file content (everything except the hash field itself). */
  hash: string
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
  metadata?: Record<string, unknown>
  /** Composite-node sub-graphs (back-compat, optional). */
  groups?: Record<string, NodeGroup>
}

/** Operation log entry — each line of history.jsonl. */
export interface HistoryEntryV1 {
  schemaVersion: 1
  ts: string
  /** user / ai:<model-id> / cli / kernel:undo / kernel:migration / etc. */
  actor: string
  batchId: string
  prevHash: string
  newHash: string
  ops: ReadonlyArray<Record<string, unknown>>
  /**
   * Optional human-readable annotation for the batch (additive, v1-compatible).
   * AI / CLI callers may set this so editors can surface a meaningful history
   * label (e.g. "AI: 创建山脉 ×2") instead of an op-type summary. Absent on
   * pre-existing entries and on callers that do not annotate.
   */
  label?: string
}

/** Per-port output cache entry — written under outputs/<nodeId>/<portId>.json. */
export interface OutputCacheV1 {
  schemaVersion: 1
  valid: boolean
  executedAt: string
  /** graph.hash at execution time. */
  executedHash: string
  /** OpSpec.implementationRevision at execution time, when the op declares one. */
  opRevision?: string
  /** Logical type of the value (port type from OpSpec). */
  type: string
  /** Optional opaque preview metadata for UI panels. */
  preview?: Record<string, unknown>
  /** Inline JSON payload (small outputs). Mutually exclusive with binFile / dataChunks. */
  data?: unknown
  /** Path to a sibling .bin when the payload is large or binary. */
  binFile?: string
  /**
   * Number of shard files holding a large array `data` (DataTreeEntry[]). When
   * present, the inline `data` is absent and the value lives under
   * outputs/<nodeId>/<portId>.data/chunk-NNN.json (one file per array element).
   * OutputCache.read reassembles the array in memory and strips this field, so
   * callers always see a normal `data`. Sharding keeps both write and read from
   * ever building a string near V8's single-string limit, regardless of how
   * many subtree nodes / layers the scene carries.
   */
  dataChunks?: number
  /**
   * Cached result of `OutputCache.shardedDataByteSize()`/`envelopeByteSize()` at
   * the time this port was written — computed once here (when the chunk files
   * are freshly known and about to be scanned anyway) instead of being
   * recomputed by an O(chunk count) directory scan on every subsequent
   * portByteSize()/envelopeByteSize() call from the HTTP layer. Absent on
   * entries written before this field existed; callers fall back to scanning.
   */
  estimatedExpandedBytes?: number
  /** Cached result of `OutputCache.envelopeByteSize()` — see `estimatedExpandedBytes`. */
  estimatedEnvelopeBytes?: number
}

export type StorageError =
  | { kind: 'parse'; path: string; reason: string }
  | { kind: 'invariant'; reason: string }
  | { kind: 'concurrent-write'; expectedHash: string; actualHash: string }
  | { kind: 'io'; path: string; reason: string }
