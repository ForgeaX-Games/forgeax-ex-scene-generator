// Shared types for the pipeline store facade and extracted modules.
// Kept out of pipelineStore.ts so helpers can type `get`/`set` without
// importing the zustand store (which would cycle).

import type { StoreApi } from 'zustand'
import type { Node, Edge } from '../xyflow.js'
import type { ExecutionResult, PipelineSnapshot } from '@forgeax/node-runtime'
import type { RefreshReason } from '../utils/refreshTrace.js'
import type {
  Battery,
  BatteryAccess,
  BatteryCategory,
  BatteryOrder,
  CanvasFrame,
  ExposedPort,
  NodeGroup,
  Pipeline,
  PipelineNode,
  PipelineEdge,
  PipelineStatus,
} from '../types.js'

export interface CompileInfo {
  status: 'success' | 'error' | 'compiling'
  message: string
}

export type DynamicPort = { name: string; type: string; label: string; access?: BatteryAccess }

export interface PipelineState {
  batteries: Battery[]
  categories: BatteryCategory[]
  batteryOrder: BatteryOrder
  currentPipeline: Pipeline | null
  /** Non-null while a session restore is pending; the canvas rebuilds then clears it. */
  sessionRestorePending: Pipeline | null
  /**
   * Monotonic counter bumped on every `loadPipeline()` (initial load + any
   * graph:applied refetch). The canvas keys its full RF rebuild on this so a
   * refetch with new content but the SAME pipeline id ('main') still rebuilds.
   * Local edits go through RF setters and intentionally do NOT bump this.
   */
  pipelineRevision: number
  pipelineStatus: PipelineStatus
  /**
   * True while `refreshConnectedOutputs` has an in-flight fan-out pass (the
   * O(nodes×ports) output-cache read triggered by mount / project-switch /
   * graph:applied / exec:completed). Read-only signal for loading-progress UI
   * (e.g. the authoring's project-switch status panel) — nothing here gates
   * on it; it is purely additive telemetry.
   */
  outputsRefreshBusy: boolean
  selectedNode: PipelineNode | null
  selectedNodeIds: string[]
  /** Backend-driven selection signal; the canvas consumes then clears it. */
  pendingSelectNodeIds: string[] | null
  logs: string[]
  compileInfo: CompileInfo | null
  /** Per-node output port values: nodeId → portName → value. */
  nodeOutputs: Record<string, Record<string, unknown>>
  /** Dynamic output port snapshots: nodeId → port list. */
  dynamicOutputPorts: Record<string, DynamicPort[]>
  /** Group-view navigation stack; empty = root level. */
  groupViewStack: string[]

  // Catalog
  setBatteries: (batteries: Battery[]) => void
  setCategories: (categories: BatteryCategory[]) => void
  /** Load the catalog + categories + order from the transport. */
  loadBatteries: () => Promise<void>
  fetchBatteryOrder: () => Promise<void>
  saveBatteryOrder: (order: BatteryOrder) => Promise<void>

  // Pipeline + selection
  setPipeline: (pipeline: Pipeline | null) => void
  setSelectedNode: (node: PipelineNode | null) => void
  setSelectedNodeIds: (ids: string[]) => void
  requestSelectNodes: (ids: string[]) => void
  clearSelectRequest: () => void
  setNodePreview: (nodeIds: string[], enabled: boolean) => void
  addLog: (log: string) => void
  clearLogs: () => void
  setCompileInfo: (info: CompileInfo | null) => void

  // Outputs / dynamic ports
  setNodeOutput: (nodeId: string, portName: string, value: unknown) => void
  clearNodeOutputs: (nodeIds: string[]) => void
  setNodeDynamicOutputPorts: (nodeId: string, ports: DynamicPort[]) => void
  clearNodeDynamicOutputPorts: (nodeIds: string[]) => void

  // Session restore
  restoreSession: () => Promise<void>
  clearSessionRestore: () => void

  // Graph mutations (data layer)
  addNode: (node: PipelineNode) => void
  updateNode: (nodeId: string, updates: Partial<PipelineNode>) => void
  removeNode: (nodeId: string) => void
  addEdge: (edge: PipelineEdge) => void
  removeEdge: (edgeId: string) => void

  // Groups
  addGroup: (group: NodeGroup) => void
  removeGroup: (groupId: string) => void
  renameGroup: (groupId: string, name: string) => void
  updateGroup: (groupId: string, updates: Partial<NodeGroup>) => void
  updateGroupPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
    patch: Partial<Pick<ExposedPort, 'hidden' | 'customLabel' | 'customLabelEn' | 'order' | 'portType'>>,
  ) => { ok: boolean; reason?: string }
  /** Reorder an exposed group port: delta=-1 moves up, delta=1 moves down. */
  moveGroupPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
    delta: -1 | 1,
  ) => { ok: boolean; reason?: string }
  /**
   * Create a new (initially unmapped) exposed port on a group, used by the
   * group-view shell's "+" button. Allocates a fresh stable id (in_N / out_N).
   * Bind it to a real inner port later via {@link bindGroupExposedPort}.
   */
  addGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
  ) => { ok: boolean; portName?: string; reason?: string }
  /**
   * True-delete an exposed port from a group (NOT hide): removes it from
   * exposedInputs/Outputs and drops any external edge referencing it, anywhere
   * it is instanced. The outer group instance auto-derives `unsaved*`.
   */
  removeGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
  ) => { ok: boolean; reason?: string }
  /** Bind / re-wire an exposed port to a real inner port (shell↔inner connect). */
  bindGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
    mapping: { sourceNodeId: string; sourcePortName: string; portType?: string; access?: ExposedPort['access'] },
  ) => { ok: boolean; reason?: string }
  /** Unbind an exposed port (shell↔inner disconnect): keeps the port, clears its mapping. */
  unbindGroupExposedPort: (
    groupId: string,
    direction: 'input' | 'output',
    portName: string,
  ) => { ok: boolean; reason?: string }
  /**
   * Update a single param of one inner node of a group, then trigger an
   * incremental execution. Used by the GroupNode option pickers, which edit an
   * inner node's param directly.
   */
  updateGroupInnerNodeParam: (groupId: string, innerNodeId: string, key: string, value: unknown) => void

  // Group-view navigation
  enterGroupView: (groupId: string) => void
  exitGroupView: () => void
  popGroupViewTo: (depth: number) => void
  /**
   * Probe a group's inner sub-graph and fill `nodeOutputs` with each inner
   * node's real outputs (keyed by inner node id), so the INTERNAL view's wire
   * data-probes show real data + types instead of empty "any / no result". A
   * group executes as a black box (its inner intermediates are discarded), so
   * the editor re-runs the inner sub-graph on demand when entering its view.
   */
  probeGroupInnerOutputs: (groupId: string) => Promise<void>

  // Params + execution
  updateNodeParam: (nodeId: string, key: string, value: unknown, silent?: boolean) => void
  persistSession: () => Promise<void>
  /** Debounced best-effort session persist for high-frequency layout/UI changes. */
  schedulePersistSession: (reason?: string) => void
  incrementalExecute: (
    nodeId: string,
    fullExec?: boolean,
    options?: { persist?: boolean; localParamEdit?: boolean; localPreviewEdit?: boolean },
  ) => Promise<ExecutionResult | undefined>
  executePipeline: (opts?: { quietErrors?: boolean }) => Promise<void>
  /** Wipe server + in-memory output caches, then run the full pipeline. */
  clearCacheAndExecutePipeline: () => Promise<void>
  /**
   * Run the whole pipeline once on project open IFF the output cache is cold
   * (no retained values hydrated). After a cache wipe / first open the graph has
   * inputs but no outputs, so nothing renders and groups can't be probed until
   * the user nudges an input — auto-run so the canvas (and every group's inner
   * view) is populated immediately. A no-op when outputs already exist, so a warm
   * reload never re-runs an expensive graph.
   */
  autoExecuteOnOpen: () => Promise<void>
  stopPipeline: () => Promise<void>

  // Loading
  loadPipeline: () => Promise<void>
  /** Apply a pipeline snapshot already returned by POST /view (avoids a duplicate GET). */
  hydratePipelineFromSnapshot: (pipeline: Pipeline | PipelineSnapshot) => void

  // AI-agent operations (same path as human edits: history + data + RF + exec)
  registerRfSetters: (setters: {
    setNodes: React.Dispatch<React.SetStateAction<Node[]>>
    setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
    onUngroup?: (groupId: string) => void
    onEnterGroup?: (groupId: string) => void
  }) => void
  agentAddNode: (node: PipelineNode) => void
  agentRemoveNodes: (nodeIds: string[]) => void
  agentAddEdge: (edge: PipelineEdge) => void
  agentRemoveEdges: (edgeIds: string[]) => void
  agentUpdateParams: (nodeId: string, params: Record<string, unknown>) => void

  // Live-sync: subscribe to graph:applied → refetch snapshot, and node-output
  // events → refresh the nodeOutputs cache. Returns unsubscribe.
  subscribeLiveSync: () => () => void
  /** Pull retained last-run values for connected and visible output ports into nodeOutputs. */
  refreshConnectedOutputs: (reason?: RefreshReason) => Promise<void>

  // Canvas annotations
  addAnnotation: (position: { x: number; y: number }) => string
  /** Copy an existing annotation to a new flow position; returns new id, or null if source missing. */
  duplicateAnnotation: (sourceId: string, position: { x: number; y: number }) => string | null
  updateAnnotation: (id: string, text: string, width?: number, height?: number) => void
  moveAnnotation: (id: string, position: { x: number; y: number }) => void
  removeAnnotation: (id: string) => void

  // Canvas frames
  addFrame: (frame: CanvasFrame) => void
  renameFrame: (frameId: string, name: string) => void
  removeFrame: (frameId: string) => void
  updateFrame: (frameId: string, updates: Partial<CanvasFrame>) => void
}

export type PipelineGet = StoreApi<PipelineState>['getState']
export type PipelineSet = StoreApi<PipelineState>['setState']
