// Group-view geometry + id predicates. Used by useCanvasGroupView; public
// symbols are re-exported from that hook so Canvas import paths stay stable.

import type { Node } from '../../xyflow.js'
import { usePipelineStore } from '../../stores/index.js'
import type { Battery, NodeGroup, PipelineEdge, PipelineNode } from '../../types.js'
import {
  BOUNDARY_INPUT_PREFIX,
  BOUNDARY_OUTPUT_PREFIX,
  CONTEXT_INPUT_PREFIX,
  CONTEXT_OUTPUT_PREFIX,
} from './groupBoundaryIds.js'

export const BOUNDARY_EDGE_PREFIX = '__boundary_edge__'
export const CONTEXT_GAP_X = 64
export const CONTEXT_MIN_GAP_Y = 28
export const CONTEXT_LABEL_OVERHANG_Y = 26
const NODE_HEADER_ESTIMATE = 34
const NODE_PORTS_VERTICAL_ESTIMATE = 16
const PORT_ROW_HEIGHT_ESTIMATE = 23
const PORT_ROW_GAP_ESTIMATE = 4
export const GROUP_NODE_MIN_HEIGHT = 90

// The "shell" boundary nodes (group_input / group_output) sit BETWEEN the inner
// nodes and the external context nodes. They represent the group's edited
// exposed ports and bridge each external up/downstream wire to the real inner
// port via a short mapping segment.
export const SHELL_WIDTH = 250            // matches GroupBoundaryNode.css min-width
export const SHELL_GAP_X = 80             // gap shell↔inner and shell↔context
const SHELL_HEADER_ESTIMATE = 40
const SHELL_PORT_ROW_ESTIMATE = 32
const SHELL_VPAD_ESTIMATE = 18
// Mapping segment (shell ↔ real inner port) edge id prefix; counts as a boundary
// edge so it is never written back into the group's own inner edges.
export const BOUNDARY_MAP_PREFIX = '__boundary_map__'

export function estimateShellHeight(portCount: number): number {
  return SHELL_HEADER_ESTIMATE + Math.max(1, portCount) * SHELL_PORT_ROW_ESTIMATE + SHELL_VPAD_ESTIMATE
}

export function isGroupContextInputNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.startsWith(CONTEXT_INPUT_PREFIX)
}

export function isGroupContextOutputNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.startsWith(CONTEXT_OUTPUT_PREFIX)
}

export function getGroupContextInputSourceNodeId(nodeId: string): string {
  return nodeId.slice(CONTEXT_INPUT_PREFIX.length)
}

export function getGroupContextOutputTargetNodeId(nodeId: string): string {
  return nodeId.slice(CONTEXT_OUTPUT_PREFIX.length)
}


export function isBoundaryInputNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.startsWith(BOUNDARY_INPUT_PREFIX)
}

export function isBoundaryOutputNodeId(nodeId: string | null | undefined): nodeId is string {
  return typeof nodeId === 'string' && nodeId.startsWith(BOUNDARY_OUTPUT_PREFIX)
}

export function getGroupIdFromBoundaryNodeId(nodeId: string): string {
  if (nodeId.startsWith(BOUNDARY_INPUT_PREFIX)) return nodeId.slice(BOUNDARY_INPUT_PREFIX.length)
  if (nodeId.startsWith(BOUNDARY_OUTPUT_PREFIX)) return nodeId.slice(BOUNDARY_OUTPUT_PREFIX.length)
  return nodeId
}

export function isBoundaryNodeId(nodeId: string): boolean {
  return nodeId.startsWith(BOUNDARY_INPUT_PREFIX)
    || nodeId.startsWith(BOUNDARY_OUTPUT_PREFIX)
    || isGroupContextInputNodeId(nodeId)
    || isGroupContextOutputNodeId(nodeId)
}

export function isBoundaryEdge(edge: PipelineEdge): boolean {
  return edge.id.startsWith(BOUNDARY_EDGE_PREFIX)
    || edge.id.startsWith(BOUNDARY_MAP_PREFIX)
    || isBoundaryNodeId(edge.source.nodeId)
    || isBoundaryNodeId(edge.target.nodeId)
}

function getNodeWidth(node: Node): number {
  return typeof node.style?.width === 'number' ? node.style.width : 200
}

function getNodeHeight(node: Node): number {
  return typeof node.style?.height === 'number' ? node.style.height : 90
}

export function computeNodeBounds(nodes: Node[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 360, maxY: 180 }
  }
  return nodes.reduce(
    (acc, node) => {
      const width = getNodeWidth(node)
      const height = getNodeHeight(node)
      return {
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x + width),
        maxY: Math.max(acc.maxY, node.position.y + height),
      }
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function estimatePortRowsHeight(rowCount: number): number {
  if (rowCount <= 0) return 0
  return rowCount * PORT_ROW_HEIGHT_ESTIMATE + (rowCount - 1) * PORT_ROW_GAP_ESTIMATE
}

export function estimateBatteryNodeHeight(node: PipelineNode, battery: Battery): number {
  const savedHeight = typeof node.params?._nodeHeight === 'number' ? node.params._nodeHeight : undefined
  if (savedHeight !== undefined) return savedHeight

  const dynCfg = battery.dynamicInputs
  const fixedInputCount = dynCfg
    ? battery.inputs.filter(input => !input.name.startsWith(dynCfg.prefix)).length
    : battery.inputs.length
  const dynamicInputCount = dynCfg
    ? (typeof node.params?.portCount === 'number' ? Math.max(dynCfg.minCount, node.params.portCount) : dynCfg.minCount)
    : 0

  const dynOutCfg = battery.dynamicOutputs
  const fixedOutputCount = battery.outputs.filter(output => !output.hidden).length
  const dynOutFromParams = Array.isArray(node.params?._dynOutPorts) ? node.params._dynOutPorts.length : undefined
  const dynamicOutputCount = dynOutCfg ? (dynOutFromParams ?? dynOutCfg.minCount) : 0

  const visibleRows = Math.max(fixedInputCount + dynamicInputCount, fixedOutputCount + dynamicOutputCount)
  const estimated = NODE_HEADER_ESTIMATE + NODE_PORTS_VERTICAL_ESTIMATE + estimatePortRowsHeight(visibleRows)
  return Math.max(GROUP_NODE_MIN_HEIGHT, Math.ceil(estimated))
}

export function estimateGroupNodeHeight(group: NodeGroup): number {
  const visibleRows = Math.max(
    group.exposedInputs.filter(port => !port.hidden).length,
    group.exposedOutputs.filter(port => !port.hidden).length,
  )
  const estimated = NODE_HEADER_ESTIMATE + NODE_PORTS_VERTICAL_ESTIMATE + estimatePortRowsHeight(visibleRows)
  return Math.max(GROUP_NODE_MIN_HEIGHT, Math.ceil(estimated))
}

export function resolveGroupContainer(groupId: string): {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  groupNodeId: string
} {
  const { currentPipeline, groupViewStack } = usePipelineStore.getState()
  const groups = currentPipeline?.groups ?? []
  const stackIndex = groupViewStack.lastIndexOf(groupId)
  const parentGroupId = stackIndex > 0 ? groupViewStack[stackIndex - 1] : null
  const parentGroup = parentGroupId ? groups.find((g) => g.id === parentGroupId) : undefined
  const nodes = parentGroup?.nodes ?? currentPipeline?.nodes ?? []
  const edges = parentGroup?.edges ?? currentPipeline?.edges ?? []
  const groupNodeId = nodes.find((n) => n.batteryId === '__group__' && n.params?.groupId === groupId)?.id ?? groupId

  return { nodes, edges, groupNodeId }
}
