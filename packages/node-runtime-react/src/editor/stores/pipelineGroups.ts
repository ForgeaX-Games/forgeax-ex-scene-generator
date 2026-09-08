// Group CRUD, exposed-port edits, and group-view stack. Takes get/set so it
// never imports the zustand store (would cycle).

import { markPipelineMutation } from './pipelinePersist.js'
import { enqueueGroupParamExecute } from './pipelineExecution.js'
import { createProbeGroupInnerOutputs } from './pipelineGroupViewBridge.js'
import type { ExposedPort, PipelineEdge, PipelineNode } from '../types.js'
import type { PipelineGet, PipelineSet, PipelineState } from './pipelineStore.types.js'

type GroupActions = Pick<
  PipelineState,
  | 'addGroup'
  | 'removeGroup'
  | 'renameGroup'
  | 'updateGroup'
  | 'updateGroupPort'
  | 'moveGroupPort'
  | 'addGroupExposedPort'
  | 'removeGroupExposedPort'
  | 'bindGroupExposedPort'
  | 'unbindGroupExposedPort'
  | 'updateGroupInnerNodeParam'
  | 'enterGroupView'
  | 'probeGroupInnerOutputs'
  | 'exitGroupView'
  | 'popGroupViewTo'
>

export function createGroupActions(get: PipelineGet, set: PipelineSet): GroupActions {
  return {
  addGroup: (group) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: [...(state.currentPipeline.groups ?? []), group],
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  removeGroup: (groupId) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: (state.currentPipeline.groups ?? []).filter((g) => g.id !== groupId),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  renameGroup: (groupId, name) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: (state.currentPipeline.groups ?? []).map((g) =>
            g.id === groupId ? { ...g, name } : g,
          ),
          // Keep the `__group__` shadow node's mirror `name` in sync with the
          // group's authoritative name. Without this the shadow node keeps its
          // old default (e.g. "Group Node") after a rename, which used to leak
          // through the persist diff and back out via drag-out (loadGroup ->
          // getGroup). The NodeGroup is the name SSOT; the shadow node is a
          // mirror, so update both together.
          nodes: state.currentPipeline.nodes.map((n) =>
            n.params?.groupId === groupId || n.id === groupId
              ? { ...n, name }
              : n,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  updateGroup: (groupId, updates) => {
    markPipelineMutation()
    set((state) => {
      if (!state.currentPipeline) return state
      return {
        currentPipeline: {
          ...state.currentPipeline,
          groups: (state.currentPipeline.groups ?? []).map((g) =>
            g.id === groupId ? { ...g, ...updates } : g,
          ),
          updatedAt: new Date().toISOString(),
        },
      }
    })
  },

  updateGroupPort: (groupId, direction, portName, patch) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }

    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    const connected = state.currentPipeline.edges.some((edge) =>
      direction === 'input'
        ? edge.target.nodeId === groupId && edge.target.port === portName
        : edge.source.nodeId === groupId && edge.source.port === portName,
    )
    if (patch.hidden === true && connected) {
      return { ok: false, reason: 'This port is connected. Disconnect it before hiding.' }
    }

    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((group) => {
          if (group.id !== groupId) return group
          const nextPorts = group[portsKey].map((port) => {
            if (port.portName !== portName) return port
            changed = true
            return { ...port, ...patch }
          })
          return { ...group, [portsKey]: nextPorts }
        }),
        updatedAt: new Date().toISOString(),
      },
    })

    if (changed) get().schedulePersistSession('group-port-patch')
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  moveGroupPort: (groupId, direction, portName, delta) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }

    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((group) => {
          if (group.id !== groupId) return group
          const ports = [...group[portsKey]]
            .map((port, index) => ({ ...port, order: typeof port.order === 'number' ? port.order : index }))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          const index = ports.findIndex((port) => port.portName === portName)
          const nextIndex = index + delta
          if (index < 0 || nextIndex < 0 || nextIndex >= ports.length) return group
          const [moved] = ports.splice(index, 1)
          ports.splice(nextIndex, 0, moved)
          changed = true
          const reordered = ports.map((port, order) => ({ ...port, order }))
          return { ...group, [portsKey]: reordered }
        }),
        updatedAt: new Date().toISOString(),
      },
    })

    if (changed) get().schedulePersistSession('group-port-move')
    return changed ? { ok: true } : { ok: false, reason: 'Port cannot be moved further' }
  },

  addGroupExposedPort: (groupId, direction) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    const prefix = direction === 'input' ? 'in_' : 'out_'
    const group = (state.currentPipeline.groups ?? []).find((g) => g.id === groupId)
    if (!group) return { ok: false, reason: 'Group not found' }

    // Allocate the next stable id (max existing in_N/out_N + 1) so it never
    // collides with a port that was deleted-then-recreated.
    let nextIndex = 0
    for (const port of group[portsKey]) {
      const match = /^(?:in|out)_(\d+)$/.exec(port.portName)
      if (match) nextIndex = Math.max(nextIndex, Number(match[1]) + 1)
    }
    const portName = `${prefix}${nextIndex}`
    const maxOrder = group[portsKey].reduce((acc, p, i) => Math.max(acc, typeof p.order === 'number' ? p.order : i), -1)
    const newPort: ExposedPort = {
      portName,
      portType: 'any',
      sourceNodeId: '',
      sourcePortName: '',
      order: maxOrder + 1,
    }

    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) =>
          g.id === groupId ? { ...g, [portsKey]: [...g[portsKey], newPort] } : g,
        ),
        updatedAt: new Date().toISOString(),
      },
    })
    get().schedulePersistSession('group-port-add')
    return { ok: true, portName }
  },

  removeGroupExposedPort: (groupId, direction, portName) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'

    // Every shadow node that instances this group (root + nested), so external
    // edges to the deleted port are dropped wherever the group is wired.
    const shadowIds = new Set<string>()
    const collectShadows = (nodes: PipelineNode[]) => {
      for (const n of nodes) if (n.batteryId === '__group__' && n.params?.groupId === groupId) shadowIds.add(n.id)
    }
    collectShadows(state.currentPipeline.nodes)
    for (const g of state.currentPipeline.groups ?? []) collectShadows(g.nodes)

    const refsPort = (e: PipelineEdge): boolean =>
      direction === 'input'
        ? shadowIds.has(e.target.nodeId) && e.target.port === portName
        : shadowIds.has(e.source.nodeId) && e.source.port === portName

    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        edges: state.currentPipeline.edges.filter((e) => !refsPort(e)),
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          const filteredEdges = g.edges.filter((e) => !refsPort(e))
          if (g.id === groupId) {
            const nextPorts = g[portsKey].filter((p) => p.portName !== portName)
            if (nextPorts.length !== g[portsKey].length) changed = true
            return { ...g, [portsKey]: nextPorts, edges: filteredEdges }
          }
          return { ...g, edges: filteredEdges }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    if (changed) {
      get().schedulePersistSession('group-port-remove')
      for (const sid of shadowIds) void get().incrementalExecute(sid, false)
    }
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  bindGroupExposedPort: (groupId, direction, portName, mapping) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            [portsKey]: g[portsKey].map((p) => {
              if (p.portName !== portName) return p
              changed = true
              return {
                ...p,
                sourceNodeId: mapping.sourceNodeId,
                sourcePortName: mapping.sourcePortName,
                portType: mapping.portType ?? p.portType,
                ...(mapping.access !== undefined ? { access: mapping.access } : {}),
              }
            }),
          }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    if (changed) {
      get().schedulePersistSession('group-port-bind')
      void get().incrementalExecute(groupId, false)
    }
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  unbindGroupExposedPort: (groupId, direction, portName) => {
    const state = get()
    if (!state.currentPipeline) return { ok: false, reason: 'No active pipeline' }
    const portsKey = direction === 'input' ? 'exposedInputs' : 'exposedOutputs'
    let changed = false
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            [portsKey]: g[portsKey].map((p) =>
              p.portName === portName
                ? ((changed = true), { ...p, sourceNodeId: '', sourcePortName: '', portType: 'any' })
                : p,
            ),
          }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    if (changed) {
      get().schedulePersistSession('group-port-unbind')
      void get().incrementalExecute(groupId, false)
    }
    return changed ? { ok: true } : { ok: false, reason: 'Port not found' }
  },

  updateGroupInnerNodeParam: (groupId, innerNodeId, key, value) => {
    const state = get()
    if (!state.currentPipeline) return
    set({
      currentPipeline: {
        ...state.currentPipeline,
        groups: (state.currentPipeline.groups ?? []).map((g) => {
          if (g.id !== groupId) return g
          return {
            ...g,
            nodes: g.nodes.map((n) =>
              n.id === innerNodeId ? { ...n, params: { ...n.params, [key]: value } } : n,
            ),
          }
        }),
        updatedAt: new Date().toISOString(),
      },
    })
    // Re-execute the outer GroupNode through the same latest-value-wins stream
    // used by root sliders. A group persist is heavier than updateNode, so
    // overlapping one per pointermove creates a backlog and preview flicker.
    enqueueGroupParamExecute(get, groupId)
  },

  enterGroupView: (groupId) =>
    set((state) => ({ groupViewStack: [...state.groupViewStack, groupId] })),

  probeGroupInnerOutputs: createProbeGroupInnerOutputs(get),

  exitGroupView: () => set((state) => ({ groupViewStack: state.groupViewStack.slice(0, -1) })),
  popGroupViewTo: (depth) =>
    set((state) => ({
      groupViewStack: state.groupViewStack.slice(0, Math.max(0, Math.min(depth, state.groupViewStack.length))),
    })),
  }
}
