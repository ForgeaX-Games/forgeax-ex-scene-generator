import { isDataTreeEntries, peelWireValue } from '@forgeax/node-runtime-react/editor'
import { parseScenePort, type ScenePortValue } from '../../../vendor/shared/types/scene/port.js'
import { childrenOf, getNode, pathOf, type NodeId, type SceneGraph, type SceneNode } from '../../../vendor/shared/types/scene/graph.js'
import { cellCount } from '../../../vendor/shared/types/scene/volume.js'

export interface SceneNodeStats {
  ownVoxels: number
  subtreeVoxels: number
  nodeCount: number
}

/**
 * v3: 节点自身不再携带 cells 数组，用 cellCount(content) 取代 .cells.length；
 * children 是 name→id 的 map，用 childrenOf(graph, node.id) 取代 node.children 数组遍历。
 */
export function collectNodeStats(graph: SceneGraph, node: SceneNode): SceneNodeStats {
  const ownVoxels = node.content ? cellCount(node.content) : 0
  let subtreeVoxels = ownVoxels
  let nodeCount = 1
  for (const child of childrenOf(graph, node.id)) {
    const childStats = collectNodeStats(graph, child)
    subtreeVoxels += childStats.subtreeVoxels
    nodeCount += childStats.nodeCount
  }
  return { ownVoxels, subtreeVoxels, nodeCount }
}

/**
 * Extract the first valid ScenePortValue from a wire-side port value.
 * Multi-branch / multi-item DataTree inputs only surface the first scene.
 */
export function extractScenePortFromWire(raw: unknown): ScenePortValue | null {
  if (raw === undefined || raw === null) return null

  if (isDataTreeEntries(raw)) {
    const firstItem = raw[0]?.items?.[0]
    return firstItem !== undefined ? parseScenePort(firstItem) : null
  }

  const peeled = peelWireValue(raw)
  return parseScenePort(peeled)
}

/** Collect ancestor node ids (inclusive of focus and the graph root) that should stay expanded to reveal `focus`. */
export function idsExpandedToFocus(graph: SceneGraph, focus: NodeId): Set<NodeId> {
  const expanded = new Set<NodeId>()
  let cur: NodeId | null = focus
  while (cur !== null) {
    expanded.add(cur)
    const node = getNode(graph, cur)
    if (!node) break
    cur = node.parent
  }
  return expanded
}

export function formatSceneNodeLabel(node: SceneNode): string {
  return node.name === '' ? '/' : node.name
}

export function readTreeRoot(port: ScenePortValue): SceneNode | null {
  return getNode(port.graph, port.focus)
}

/** Human-readable path for display only (identity/expand-state uses NodeId, never this string). */
export function focusDisplayPath(port: ScenePortValue): string {
  return pathOf(port.graph, port.focus) ?? port.focus
}
