// Pipeline store — the core editor state: battery catalog, the working
// pipeline (nodes / edges / groups / annotations / frames), selection, node
// output cache, dynamic ports, plus execution and the AI-agent live-sync path.
//
// Transport: all backend I/O goes through the editor transport (see
// src/editor/transport) which bridges onto the kernel ApiClient. Graph
// mutations are submitted as kernel Op batches via applyBatch; the kernel
// announces 'graph:applied', and subscribeLiveSync() refetches the snapshot so
// the canvas updates the same way for every actor — human, AI or CLI. This is
// the North-Star "watch the AI work": agentAdd*/Remove*/Update* drive the store
// exactly like human edits, and a graph change from any actor flows back in.
//
// Decomposition: pure helpers live in pipelineStore.helpers.ts. Execution,
// persist, output fan-out, live-sync, group-view bridging, groups, agent ops,
// and canvas extras live in sibling modules that take get/set and share
// module-level singletons. This file is the single zustand store
// (create<PipelineState>) and public export facade.

import { create } from 'zustand'

import type { PipelineSnapshot } from '@forgeax/node-runtime'

import { getEditorTransport } from '../transport/index.js'
import { snapshotToPipeline } from '../transport/mappers.js'
import {
  createEmptyPipeline,
  carryPreviewEnabledNodes,
  outputValuesEqual,
} from './pipelineStore.helpers.js'
import { syncTrace } from '../utils/syncTrace.js'

import type { Pipeline } from '../types.js'
import type { PipelineState } from './pipelineStore.types.js'
import {
  clearOutputMetaCache,
  clearOutputMetaForNodes,
  cancelDeferredProjectSwitchOutputRefresh,
  scheduleDeferredProjectSwitchOutputRefresh,
  createRefreshConnectedOutputs,
  takeFanOutMissedCatalogIfReady,
} from './pipelineOutputFanout.js'
import {
  hasLocalPipelineMutations,
  markPipelineMutation,
  markPipelineBaseline,
  bindPersistSyncedHash,
  bindPersistStore,
  createPersistSession,
  createSchedulePersistSession,
} from './pipelinePersist.js'
import {
  enqueueParamExecute,
  createIncrementalExecute,
  createExecutePipeline,
  createClearCacheAndExecutePipeline,
  createAutoExecuteOnOpen,
  createStopPipeline,
} from './pipelineExecution.js'
import {
  subscribeLocalParamEdit,
  createSubscribeLiveSync,
  flushDeferredRefreshAfterViewport,
  bindLiveSyncStore,
  setLastSyncedHash,
  getLastSyncedHash,
} from './pipelineLiveSync.js'
import { setGroupInnerSink, tryGroupInnerParam } from './pipelineGroupViewBridge.js'
import { createGroupActions } from './pipelineGroups.js'
import { createAgentOps } from './pipelineAgentOps.js'
import { createCanvasExtras } from './pipelineCanvasExtras.js'

export {
  clearOutputMetaCache,
  cancelDeferredProjectSwitchOutputRefresh,
  scheduleDeferredProjectSwitchOutputRefresh,
}
export { hasLocalPipelineMutations }
export { enqueueGroupParamExecute } from './pipelineExecution.js'
export { subscribeLocalParamEdit, flushDeferredRefreshAfterViewport }
export { setGroupInnerSink }

bindPersistSyncedHash(setLastSyncedHash)

export const usePipelineStore = create<PipelineState>((set, get) => {
  bindLiveSyncStore(get)
  bindPersistStore(get)
  return {
  batteries: [],
  categories: [],
  batteryOrder: { bigLabels: [], smallLabels: {} },
  currentPipeline: null,
  sessionRestorePending: null,
  pipelineRevision: 0,
  pipelineStatus: 'idle',
  outputsRefreshBusy: false,
  selectedNode: null,
  selectedNodeIds: [],
  pendingSelectNodeIds: null,
  logs: [],
  compileInfo: null,
  nodeOutputs: {},
  dynamicOutputPorts: {},
  groupViewStack: [],

  // ── Catalog ──────────────────────────────────────────────────────────
  setBatteries: (batteries) => set({ batteries }),
  setCategories: (categories) => set({ categories }),

  loadBatteries: async () => {
    const { api } = getEditorTransport()
    const [batteries, categories] = await Promise.all([api.getBatteries(), api.getCategories()])
    set({ batteries, categories })
    try {
      const order = await api.getBatteryOrder()
      set({ batteryOrder: order })
    } catch (error) {
      console.error('Failed to fetch battery order:', error)
    }
    // An earlier fan-out could only see edge-sourced ports because the catalog
    // was still loading; redo it now that every node's ports are resolvable.
    // 'manual' (not 'mount'): a mount pass already in flight is exactly the one
    // that missed the catalog, and 'mount' would just share its promise instead
    // of running a fresh pass.
    if (takeFanOutMissedCatalogIfReady(batteries.length)) {
      void get().refreshConnectedOutputs('manual')
    }
  },

  fetchBatteryOrder: async () => {
    try {
      const order = await getEditorTransport().api.getBatteryOrder()
      set({ batteryOrder: order })
    } catch (error) {
      console.error('Failed to fetch battery order:', error)
    }
  },

  saveBatteryOrder: async (order) => {
    set({ batteryOrder: order })
    try {
      await getEditorTransport().api.saveBatteryOrder(order)
    } catch (error) {
      console.error('Failed to save battery order:', error)
    }
  },

  // ── Pipeline + selection ─────────────────────────────────────────────
  setPipeline: (pipeline) =>
    set({ currentPipeline: pipeline, pipelineStatus: pipeline?.status ?? 'idle' }),

  setSelectedNode: (node) => set({ selectedNode: node }),
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  requestSelectNodes: (ids) => set(
    ids.length === 0
      ? { pendingSelectNodeIds: ids, selectedNodeIds: [], selectedNode: null }
      : { pendingSelectNodeIds: ids },
  ),
  clearSelectRequest: () => set({ pendingSelectNodeIds: null }),

  setNodePreview: (nodeIds, enabled) => {
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          nodes: state.currentPipeline.nodes.map((node) =>
            nodeIds.includes(node.id) ? { ...node, previewEnabled: enabled } : node,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
    get().schedulePersistSession('node-preview')
  },

  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${log}`] })),
  clearLogs: () => set({ logs: [] }),
  setCompileInfo: (info) => set({ compileInfo: info }),

  // ── Outputs / dynamic ports ──────────────────────────────────────────
  // Skip the state write entirely when the value is unchanged. `nodeOutputs` is
  // a single object subscribed to by every preview / probe / tooltip component
  // (e.g. GridPanelNode reads the whole map), so replacing its reference forces
  // ALL of them to re-render + redraw. During a slider drag refreshConnectedOutputs
  // re-GETs *every* connected port on each exec:completed — the unchanged slider
  // value ports and an unchanged grid would otherwise churn the reference (and
  // the grid canvas redraw) on every tick. Object.is short-circuits primitives
  // (slider values); a cheap structural compare via JSON covers grid arrays
  // (the grid output is small — a few KB — so this is far cheaper than a wasted
  // React render + full <canvas> repaint).
  setNodeOutput: (nodeId, portName, value) =>
    set((state) => {
      const prev = state.nodeOutputs[nodeId]?.[portName]
      if (outputValuesEqual(prev, value)) {
        return state
      }
      syncTrace('probe:nodeOutput-set', { nodeId, port: portName, hadPrev: prev !== undefined })
      return {
        nodeOutputs: {
          ...state.nodeOutputs,
          [nodeId]: { ...state.nodeOutputs[nodeId], [portName]: value },
        },
      }
    }),

  clearNodeOutputs: (nodeIds) =>
    set((state) => {
      const next = { ...state.nodeOutputs }
      for (const id of nodeIds) {
        delete next[id]
      }
      clearOutputMetaForNodes(nodeIds)
      return { nodeOutputs: next }
    }),

  setNodeDynamicOutputPorts: (nodeId, ports) =>
    set((state) => {
      const nextDynOut = { ...state.dynamicOutputPorts, [nodeId]: ports }
      const nextPipeline = state.currentPipeline
        ? {
            ...state.currentPipeline,
            nodes: state.currentPipeline.nodes.map((n) =>
              n.id === nodeId ? { ...n, params: { ...n.params, _dynOutPorts: ports } } : n,
            ),
            updatedAt: new Date().toISOString(),
          }
        : state.currentPipeline
      return { dynamicOutputPorts: nextDynOut, currentPipeline: nextPipeline }
    }),

  clearNodeDynamicOutputPorts: (nodeIds) =>
    set((state) => {
      const nextDynOut = { ...state.dynamicOutputPorts }
      for (const id of nodeIds) delete nextDynOut[id]
      const nextPipeline = state.currentPipeline
        ? {
            ...state.currentPipeline,
            nodes: state.currentPipeline.nodes.map((n) => {
              if (!nodeIds.includes(n.id)) return n
              const { _dynOutPorts: _removed, ...restParams } = n.params as Record<string, unknown>
              void _removed
              return { ...n, params: restParams }
            }),
            updatedAt: new Date().toISOString(),
          }
        : state.currentPipeline
      return { dynamicOutputPorts: nextDynOut, currentPipeline: nextPipeline }
    }),

  // ── Session restore ──────────────────────────────────────────────────
  restoreSession: async () => {
    try {
      const pipeline = await getEditorTransport().api.getSession()
      if (pipeline && pipeline.nodes.length > 0) {
        set({ currentPipeline: pipeline, sessionRestorePending: pipeline })
      }
    } catch (error) {
      console.error('[Session] Failed to restore session:', error)
    }
  },

  clearSessionRestore: () => set({ sessionRestorePending: null }),

  // ── Graph mutations (data layer) ─────────────────────────────────────
  addNode: (node) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) {
        return { currentPipeline: { ...createEmptyPipeline(), nodes: [node] } }
      }
      return {
        currentPipeline: {
          ...state.currentPipeline,
          nodes: [...state.currentPipeline.nodes, node],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  updateNode: (nodeId, updates) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      const existing = state.currentPipeline.nodes.find((n) => n.id === nodeId)
      let groups = state.currentPipeline.groups
      if (updates.position && existing?.batteryId === '__group__') {
        const groupId =
          typeof existing.params?.groupId === 'string' ? (existing.params.groupId as string) : nodeId
        groups = (groups ?? []).map((g) =>
          g.id === groupId ? { ...g, position: updates.position! } : g,
        )
      }
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups,
          nodes: state.currentPipeline.nodes.map((node) =>
            node.id === nodeId ? { ...node, ...updates } : node,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  removeNode: (nodeId) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          nodes: state.currentPipeline.nodes.filter((node) => node.id !== nodeId),
          edges: state.currentPipeline.edges.filter(
            (edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId,
          ),
          updatedAt: new Date().toISOString(),
        },
        selectedNode: state.selectedNode?.id === nodeId ? null : state.selectedNode,
      }
    })
  },

  addEdge: (edge) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          edges: [...state.currentPipeline.edges, edge],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  removeEdge: (edgeId) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          edges: state.currentPipeline.edges.filter((edge) => edge.id !== edgeId),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },


    ...createGroupActions(get, set),

  // ── Params + execution ───────────────────────────────────────────────
  updateNodeParam: (nodeId, key, value, silent = false) => {
    const state = get()
    if (!state.currentPipeline) return

    // In a group's internal view, an inner node's params live in the group-view
    // hook's refs (flushed on exit), not in `currentPipeline.nodes`. Route the
    // edit there so it is saved into the group (turning it `unsaved*`) instead of
    // being lost / leaking to the root graph. The sink returns false for ids it
    // does not own, so root-level edits fall through to the normal path below.
    if (tryGroupInnerParam(nodeId, key, value)) return

    // Early-out: no real change → no store write, no exec, no rerender.
    const targetNode = state.currentPipeline.nodes.find((n) => n.id === nodeId)
    if (targetNode && Object.is(targetNode.params[key], value)) return

    const updatedNodes = state.currentPipeline.nodes.map((node) =>
      node.id === nodeId ? { ...node, params: { ...node.params, [key]: value } } : node,
    )

    set({
      currentPipeline: {
        ...state.currentPipeline,
        nodes: updatedNodes,
        updatedAt: new Date().toISOString(),
      },
      selectedNode:
        state.selectedNode?.id === nodeId
          ? { ...state.selectedNode, params: { ...state.selectedNode.params, [key]: value } }
          : state.selectedNode,
    })

    if (silent) return

    syncTrace('param:update', { nodeId, key, value })

    // Drive execution as a continuous "latest value wins" stream rather than a
    // fixed-interval throttle. The slider already coalesces pushes to one per
    // animation frame; here we additionally ensure we never run two executes for
    // the same node concurrently (each round-trip is ~tens-to-hundreds of ms). If
    // an exec is in flight we just remember the latest node and fire exactly one
    // more when it settles — so the kernel always ends on the newest dragged
    // value and the preview keeps flowing without a backlog forming.
    enqueueParamExecute(get, nodeId)
  },

  persistSession: createPersistSession(get),
  schedulePersistSession: createSchedulePersistSession(get),
  incrementalExecute: createIncrementalExecute(get),
  executePipeline: createExecutePipeline(get, set),
  clearCacheAndExecutePipeline: createClearCacheAndExecutePipeline(get, set),
  autoExecuteOnOpen: createAutoExecuteOnOpen(get),
  stopPipeline: createStopPipeline(get, set),

  loadPipeline: async () => {
    const { addLog } = get()
    try {
      addLog('Loading pipeline…')
      const pipeline = await getEditorTransport().api.getPipeline()
      if (pipeline) {
        set((s) => ({
          currentPipeline: { ...pipeline, nodes: carryPreviewEnabledNodes(s.currentPipeline?.nodes, pipeline) },
          pipelineStatus: pipeline.status,
          pipelineRevision: s.pipelineRevision + 1,
        }))
        markPipelineBaseline()
        addLog('Pipeline loaded')
      }
    } catch (error) {
      console.error('Failed to load pipeline:', error)
      addLog(`Load failed: ${error}`)
    }
  },

  hydratePipelineFromSnapshot: (pipeline) => {
    const full =
      Array.isArray((pipeline as Pipeline).nodes)
        ? (pipeline as Pipeline)
        : snapshotToPipeline(pipeline as PipelineSnapshot)
    set((s) => ({
      currentPipeline: { ...full, nodes: carryPreviewEnabledNodes(s.currentPipeline?.nodes, full) },
      pipelineStatus: full.status,
      pipelineRevision: s.pipelineRevision + 1,
    }))
    markPipelineBaseline()
  },
  subscribeLiveSync: createSubscribeLiveSync(get),
  refreshConnectedOutputs: createRefreshConnectedOutputs(get, set, getLastSyncedHash),

    ...createAgentOps(get),
    ...createCanvasExtras(get, set),
  }
})
