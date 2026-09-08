import type { DomainValueFormatter } from '@forgeax/node-runtime-react/editor'
import { parseScenePort } from '../../../vendor/shared/types/scene/port.js'
import { childrenOf, getNode, type NodeId, type SceneGraph, type SceneNode } from '../../../vendor/shared/types/scene/graph.js'
import { cellCount } from '../../../vendor/shared/types/scene/volume.js'

interface SceneStats {
  totalNodes: number
  voxelCount: number
}

function collectStats(graph: SceneGraph, node: SceneNode, stats: SceneStats): void {
  stats.totalNodes += 1
  stats.voxelCount += node.content ? cellCount(node.content) : 0
  for (const child of childrenOf(graph, node.id)) collectStats(graph, child, stats)
}

function summarizeScene(value: unknown): {
  summary: string
  extra?: string
} | null {
  // parseScenePort 双模兼容：既接受进程内的活 SceneGraph 实例，也接受这个面板
  // 实际收到的形态——经 HTTP/JSON 一次往返后的 wire 对象（graph 是 plain
  // { [id]: node } map），见 vendor port.ts 顶部注释。这里不再需要自己判断
  // "是不是 wire 格式"。
  const port = parseScenePort(value)
  if (!port) return null
  const node = getNode(port.graph, port.focus)
  if (!node) return { summary: `scene focus="${port.focus as NodeId}" (missing)` }

  const stats: SceneStats = { totalNodes: 0, voxelCount: 0 }
  collectStats(port.graph, node, stats)
  const childCount = childrenOf(port.graph, node.id).length
  const ownCount = node.content ? cellCount(node.content) : 0
  const schemaPart = node.schema ? ` schema="${node.schema}"` : ''
  return {
    summary: `scene focus="${node.name || '/'}"${schemaPart} voxels=${stats.voxelCount} children=${childCount} nodes=${stats.totalNodes}`,
    extra: `own=${ownCount}`,
  }
}

export const sceneValueFormatter: DomainValueFormatter = {
  typeLabel: 'scene',
  typeLabelPlural: 'scenes',
  format(value) {
    return summarizeScene(value)?.summary
  },
  formatExtra(value) {
    return summarizeScene(value)?.extra
  },
}
