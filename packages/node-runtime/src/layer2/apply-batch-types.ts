import type { GraphEdge, GraphNode, ExposedPort, Position } from '../layer1/types/graph.js'
import type { OpAccess } from '../layer1/types/op-spec.js'

/**
 * Incremental presentation-overlay patch for one exposed group port, keyed by
 * `portName`. Only the optional overlay fields are patchable; the wiring
 * authority (portType / access / sourceNodeId / sourcePortName) is owned by
 * createGroup derivation and never mutated here. A field set to `undefined` is
 * treated as "no change"; clearing an override is done by writing its default
 * (e.g. `hidden: false`).
 */
export interface ExposedPortPatch {
  portName: string
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}

/**
 * One entry of a createGroup AUTHORITATIVE port contract. Unlike
 * `ExposedPortPatch` (a presentation overlay keyed by an already-derived
 * portName), this is the stable external identity of a boundary port that the
 * caller OWNS — used by the "drag a saved group template back onto the canvas"
 * path so a group behaves like a first-class battery: its `portName` is a
 * topology-independent stable id (assigned once at the group's birth and stored
 * in the template), NOT a name re-derived from the (volatile) inner node id.
 *
 * The kernel binds `portName` → `(sourceNodeId, sourcePortName)` and rewrites
 * boundary edges to this `portName`. The contract may explicitly preserve the
 * boundary portType/access; omitted fields are resolved from the inner member's
 * OpSpec. The presentation overlay fields ride along.
 *
 * `sourceNodeId` must reference a (post-remap) member node and `sourcePortName`
 * one of its ports; an entry that resolves to neither is dropped (the contract
 * is advisory for unknown ports, never fatal).
 */
export interface ExposedPortContract {
  portName: string
  sourceNodeId: string
  sourcePortName: string
  /**
   * Caller-owned port type override. When provided it is honoured verbatim;
   * when absent the boundary type is derived from the inner member's OpSpec
   * (`resolveBoundaryPort`). This lets a saved group carry a user-set boundary
   * type across the drag-out / re-instantiation path instead of the kernel
   * always re-deriving it (which reverted the type and flipped status to
   * `unsaved*`).
   */
  portType?: string
  access?: OpAccess
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}

/** Op record — discriminated union over edit primitives. */
export type Op =
  | {
      type: 'createNode'
      nodeId: string
      opId: string
      // Display-only canvas coordinate. OPTIONAL: headless callers (AI / CLI)
      // may omit it and the kernel auto-assigns an edge-aware incremental layout
      // slot for nodes added in this batch only (see `layoutIncrementalNewNodes`).
      // When `autoLayoutNew: false`, falls back to the legacy grid slot
      // (`autoNodePosition`). The editor always supplies a real drag pos.
      position?: { x: number; y: number }
      params: Record<string, unknown>
      // Optional display name (additive; preserves labels on graph import).
      name?: string
      // Optional preview toggle (additive; preserves the editor's disable-preview
      // state across a graph import/re-instantiation).
      previewEnabled?: boolean
    }
  | { type: 'updateNode'; nodeId: string; params?: Record<string, unknown>; position?: { x: number; y: number }; name?: string; previewEnabled?: boolean }
  | { type: 'deleteNode'; nodeId: string }
  | {
      type: 'connect'
      // OPTIONAL: omit and the kernel mints a unique edge id (see `mintEdgeId`).
      // The editor supplies its own stable id; headless callers need not bother.
      edgeId?: string
      source: { nodeId: string; port: string }
      target: { nodeId: string; port: string }
    }
  | { type: 'disconnect'; edgeId: string }
  /**
   * Alias for `disconnect` (2026-07-10 postmortem): every Sino-facing skill
   * doc / aw-support orchestration prompt (`session_operation.md`,
   * `fast-loop.md`, `sino-planning-discipline.ts`, `scene-graph-analysis.ts`,
   * `continuation.ts`, …) has for a long time instructed the agent to delete
   * edges via `{ type: "deleteEdge", edgeId }` — but the kernel's `Op` union
   * and `applyOps` switch only ever recognized `disconnect`. Because the
   * switch below had no `default` diagnostic, an unrecognized `type` was
   * silently skipped: the batch still returned `status:'ok'`, the edge
   * stayed in the graph, and the agent had no signal its delete never
   * happened — producing exactly the "deleteEdge 返回 ok 但边未实际移除" /
   * repeated Rest fan-out failures seen in real sessions. Rather than a slow
   * doc-by-doc rewrite across every prompt/skill file, the kernel now accepts
   * `deleteEdge` as a first-class alias with identical semantics to
   * `disconnect`, and unknown op types get a loud diagnostic (see the
   * `default` branch in `applyOps`) instead of a silent no-op.
   */
  | { type: 'deleteEdge'; edgeId: string }
  | { type: 'setMetadata'; key: string; value: unknown }
  | {
      // Delete a composite group as a single battery: remove the shadow node,
      // its packed sub-graph entry, and all outer boundary edges. Unlike
      // `ungroup`, this intentionally does not restore inner members.
      type: 'deleteGroup'
      groupId: string
    }
  | {
      // Wraps a set of currently top-level nodes into a single composite
      // group node. The group appears in `graph.nodes` with the special
      // opId `__group__`; its sub-graph (member nodes + internal edges +
      // auto-derived exposed ports) lives in `graph.groups[groupId]`.
      // Edges that crossed the boundary are rewritten to reference the
      // group node id and a synthetic exposed-port name. v0.2.0 supports
      // single-level groups only — members must be plain nodes (not
      // already-grouped or themselves group nodes); nested groups land
      // in a follow-up.
      type: 'createGroup'
      groupId: string
      name: string
      memberNodeIds: readonly string[]
      // Display-only canvas coordinate. OPTIONAL for headless callers — same
      // incremental layout as createNode when omitted. Nested template groups
      // still carry template-relative positions; only the root shadow is
      // typically omitted by instantiateTemplate.
      position?: { x: number; y: number }
      nameEn?: string
      // AUTHORITATIVE exposed-port contract. When present, the caller OWNS the
      // boundary identity of the group: each entry binds a STABLE `portName`
      // (a topology-independent id minted once at the group's birth and stored
      // in its template — e.g. `in_0`, `out_1`) to its inner mapping
      // `(sourceNodeId, sourcePortName)`. The kernel rewrites boundary edges to
      // these stable names instead of re-deriving names from the (volatile,
      // post-remap) inner node ids. This is what lets a group behave like a
      // first-class battery: its outward port names never shift when it is
      // re-instantiated from a template (the original "drop a saved group →
      // ports disconnect / no result" bug). Explicit portType/access fields
      // preserve the template contract; omitted fields are resolved from the
      // inner OpSpec. Presentation overlay (hidden/order/customLabel*) rides
      // along. Entries whose (sourceNodeId, sourcePortName) resolves to no
      // live member port are dropped (advisory, never fatal). Members/ports
      // present in the topology but absent from the contract still get a
      // freshly-allocated stable name so nothing is silently lost.
      //
      // When ABSENT (ordinary "select nodes → group"), the kernel derives the
      // ports from topology and mints fresh sequential stable names itself.
      exposedPorts?: {
        inputs?: readonly ExposedPortContract[]
        outputs?: readonly ExposedPortContract[]
      }
    }
  | {
      // Mutate an existing group's metadata. Member reshuffling is
      // intentionally out of scope for v0.2.0 — use ungroup + createGroup
      // for now. Provided fields replace; omitted fields preserve.
      type: 'updateGroup'
      groupId: string
      name?: string
      nameEn?: string
      position?: { x: number; y: number }
      // Incremental presentation-overlay patch for already-exposed ports,
      // keyed by portName. Only the overlay fields (hidden/order/customLabel*)
      // are patched; the wiring authority (portType/access/source*) is never
      // touched. Unknown portNames are ignored (the port set is owned by
      // createGroup/ungroup, not this op).
      exposedPorts?: {
        inputs?: readonly ExposedPortPatch[]
        outputs?: readonly ExposedPortPatch[]
      }
      // FULL exposed-port set replacement (wiring authority + overlay). The
      // overlay-only `exposedPorts` patch above cannot express the group inner
      // view's "shell" structural edits — adding a brand-new port (`+新建端口`),
      // true-deleting one, or rebinding it to a different inner port. When
      // present, the provided direction REPLACES
      // `graph.groups[groupId].exposed{Inputs,Outputs}` wholesale, so the
      // editor's post-edit port set becomes the new SSOT (mirrors how
      // `nodes`/`edges` below replace the inner sub-graph). A placeholder port
      // created by `+新建端口` carries an empty source mapping until it is wired.
      exposedWiring?: {
        inputs?: readonly ExposedPort[]
        outputs?: readonly ExposedPort[]
      }
      // Inner sub-graph edits made in the group's internal view. When present,
      // each REPLACES the corresponding field of `graph.groups[groupId]`
      // wholesale (the editor flushes the full, post-edit inner arrays on exit):
      //   - `nodes`   — member node objects (param/name edits inside the view)
      //   - `edges`   — member-to-member internal edges (connect/disconnect)
      //   - `innerLayout` — display-only inner positions
      // Without this, internal-view connection edits were flushed to the client
      // store but never persisted to the kernel sub-graph, so the next
      // getPipeline re-pull reverted them.
      nodes?: readonly GraphNode[]
      edges?: readonly GraphEdge[]
      innerLayout?: Record<string, Position>
    }
  | {
      // Restore the group's sub-graph to the outer view. Member nodes
      // and internal edges are re-introduced into graph.nodes /
      // graph.edges; outer edges referencing the group via exposed
      // ports are rewritten back to the inner endpoints. The group
      // shadow node and graph.groups entry are deleted.
      type: 'ungroup'
      groupId: string
    }

export interface ApplyBatchOptions {
  // Run full validation but do not write. Useful for dry-run / preview.
  dryRun?: boolean
  // Optimistic concurrency token. Reject if current graph hash differs.
  expectedPrevHash?: string
  // Audit field — who is performing this batch. Default 'unknown'.
  actor?: string
  // Optional human-readable annotation persisted on the history entry, letting AI / CLI callers describe a batch (e.g. "AI: 创建山脉 ×2") so editors can show a meaningful label.
  label?: string
  // Override the timestamp used for history.ts. Default new Date().toISOString().
  ts?: string
  // Override the batchId used in history. Default random UUID.
  batchId?: string
  /**
   * Ephemeral (high-frequency intermediate) batch — e.g. a live slider-drag
   * tick. Persists graph.json + invalidates the output cache + emits
   * graph:applied EXACTLY like a normal batch (so SSOT and live consumers stay
   * correct), but writes NO audit line to history.jsonl. The settled value is
   * committed by a later non-ephemeral batch, so the audit log records the
   * final state — not every drag tick. Default false.
   */
  ephemeral?: boolean
  /**
   * When true (default), nodes created without an explicit `position` in this
   * batch are placed using edge-aware incremental layout. Existing nodes are
   * never moved. Set false to fall back to the legacy grid slot assignment.
   */
  autoLayoutNew?: boolean
}

export type Diagnostic = { opIndex: number; severity: 'error' | 'warn'; message: string }

export interface ApplyBatchResult {
  status: 'ok' | 'rejected'
  // New graph hash if status === 'ok'.
  newHash?: string
  // Rejection reason if status === 'rejected'.
  reason?: string
  // Per-op validation findings (for UI surfacing).
  diagnostics?: ReadonlyArray<Diagnostic>
  // History batchId on ok.
  batchId?: string
  /** True when the batch only repositions / updates presentation metadata. */
  layoutOnly?: boolean
  /** Nodes whose output cache was invalidated by this batch (topology change). */
  invalidatedNodeCount?: number
}
