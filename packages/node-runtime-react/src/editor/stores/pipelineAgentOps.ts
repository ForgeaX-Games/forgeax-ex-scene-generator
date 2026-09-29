// AI-agent graph ops: same path as human edits (history + data + RF + exec).
// ReactFlow setter refs live here (module-level; the canvas registers them).

import type { Dispatch, SetStateAction } from 'react'
import type { Node, Edge } from '../xyflow.js'
import { useHistoryStore } from './historyStore.js'
import { formatIdAsLabel } from '../utils/batteryLabels.js'
import { nodeNameEn } from './pipelineStore.helpers.js'
import type { PipelineGet, PipelineState } from './pipelineStore.types.js'

type RfSetters = {
  setNodes: Dispatch<SetStateAction<Node[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  onUngroup?: (groupId: string) => void
  onEnterGroup?: (groupId: string) => void
}

let _rfSetters: RfSetters | null = null

type AgentActions = Pick<
  PipelineState,
  | 'registerRfSetters'
  | 'agentAddNode'
  | 'agentRemoveNodes'
  | 'agentAddEdge'
  | 'agentRemoveEdges'
  | 'agentUpdateParams'
>

export function createAgentOps(get: PipelineGet): AgentActions {
  return {
  registerRfSetters: (setters) => {
    _rfSetters = setters
  },

  agentAddNode: (node) => {
    const state = get()
    const battery = state.batteries.find((b) => b.id === node.batteryId)
    if (!battery) {
      console.warn(`[Agent] agentAddNode: battery not found: ${node.batteryId}`)
      return
    }
    if (state.currentPipeline) {
      useHistoryStore.getState().record('add_node', state.currentPipeline, {
        nodeIds: [node.id],
        label: `AI 添加节点：${battery.name}`,
        labelEn: `AI add node: ${battery.nameEn ?? formatIdAsLabel(battery.id)}`,
      })
    }
    get().addNode(node)
    if (_rfSetters) {
      const rfNode: Node = {
        id: node.id,
        type: battery.nodeType ?? 'battery',
        position: node.position,
        data: { battery, params: node.params ?? {} },
        selected: false,
      }
      _rfSetters.setNodes((nds) => [...nds, rfNode])
    }
    // AI-type batteries run on explicit user request, so skip auto-exec.
    if (battery.type !== 'ai') void get().incrementalExecute(node.id, false)
  },

  agentRemoveNodes: (nodeIds) => {
    const state = get()
    if (!state.currentPipeline) return
    const allEdges = state.currentPipeline.edges
    const deletedIds = new Set(nodeIds)

    const survivingDownstreamIds = new Set<string>()
    for (const nodeId of nodeIds) {
      allEdges
        .filter((e) => e.source.nodeId === nodeId)
        .map((e) => e.target.nodeId)
        .filter((id) => !deletedIds.has(id))
        .forEach((id) => survivingDownstreamIds.add(id))
    }

    const label = nodeIds.length > 1 ? `AI 删除 ${nodeIds.length} 个节点` : `AI 删除节点`
    const labelEn = nodeIds.length > 1 ? `AI delete ${nodeIds.length} nodes` : `AI delete node`
    useHistoryStore.getState().record('delete_node', state.currentPipeline, { nodeIds, label, labelEn })

    for (const nodeId of nodeIds) {
      get().removeNode(nodeId)
      get().clearNodeOutputs([nodeId])
      get().clearNodeDynamicOutputPorts([nodeId])
    }

    if (_rfSetters) {
      _rfSetters.setNodes((nds) => nds.filter((n) => !deletedIds.has(n.id)))
      _rfSetters.setEdges((eds) => eds.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)))
    }

    void get().persistSession()
    for (const downId of survivingDownstreamIds) void get().incrementalExecute(downId, false)
  },

  agentAddEdge: (edge) => {
    const state = get()
    if (!state.currentPipeline) return
    const srcNode = state.currentPipeline.nodes.find((n) => n.id === edge.source.nodeId)
    const tgtNode = state.currentPipeline.nodes.find((n) => n.id === edge.target.nodeId)
    const srcName = srcNode?.name ?? edge.source.nodeId
    const tgtName = tgtNode?.name ?? edge.target.nodeId
    const srcNameEn = srcNode ? nodeNameEn(srcNode, state.batteries) : edge.source.nodeId
    const tgtNameEn = tgtNode ? nodeNameEn(tgtNode, state.batteries) : edge.target.nodeId
    useHistoryStore.getState().record('connect_edge', state.currentPipeline, {
      edgeIds: [edge.id],
      label: `AI 连线：${srcName} → ${tgtName}`,
      labelEn: `AI connect: ${srcNameEn} → ${tgtNameEn}`,
    })

    get().addEdge(edge)

    if (_rfSetters) {
      // Item ports keep one wire. List / tree ports keep every referenced item.
      const tgtBattery = tgtNode
        ? state.batteries.find((item) => item.id === tgtNode.batteryId)
        : undefined
      const tgtAccess = tgtBattery?.inputs.find((port) => port.name === edge.target.port)?.access
      const replaceExisting = tgtAccess !== 'list' && tgtAccess !== 'tree'
      _rfSetters.setEdges((eds) => {
        const filtered = replaceExisting
          ? eds.filter(
              (e) => !(e.target === edge.target.nodeId && e.targetHandle === edge.target.port),
            )
          : eds.filter((e) => e.id !== edge.id)
        return [
          ...filtered,
          {
            id: edge.id,
            source: edge.source.nodeId,
            target: edge.target.nodeId,
            sourceHandle: edge.source.port,
            targetHandle: edge.target.port,
            animated: false,
          },
        ]
      })
    }

    void get().incrementalExecute(edge.target.nodeId, false)
  },

  agentRemoveEdges: (edgeIds) => {
    const state = get()
    if (!state.currentPipeline) return
    const edgeIdSet = new Set(edgeIds)
    const removedEdges = state.currentPipeline.edges.filter((e) => edgeIdSet.has(e.id))
    if (removedEdges.length === 0) return

    const label = removedEdges.length > 1 ? `AI 删除 ${removedEdges.length} 条连线` : 'AI 删除连线'
    const labelEn = removedEdges.length > 1 ? `AI delete ${removedEdges.length} connections` : 'AI delete connection'
    useHistoryStore.getState().record('delete_edge', state.currentPipeline, { edgeIds, label, labelEn })

    const targetNodeIds = [...new Set(removedEdges.map((e) => e.target.nodeId))]
    for (const eid of edgeIds) get().removeEdge(eid)
    if (_rfSetters) _rfSetters.setEdges((eds) => eds.filter((e) => !edgeIdSet.has(e.id)))
    for (const targetId of targetNodeIds) void get().incrementalExecute(targetId, false)
  },

  agentUpdateParams: (nodeId, params) => {
    const state = get()
    if (!state.currentPipeline) return
    const node = state.currentPipeline.nodes.find((n) => n.id === nodeId)
    if (!node) return

    useHistoryStore.getState().record('change_param', state.currentPipeline, {
      nodeIds: [nodeId],
      label: `AI 更新参数：${node.name}`,
      labelEn: `AI update params: ${nodeNameEn(node, state.batteries)}`,
    })

    for (const [key, value] of Object.entries(params)) get().updateNodeParam(nodeId, key, value)

    if (_rfSetters) {
      _rfSetters.setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } } : n,
        ),
      )
    }
  },
  }
}
