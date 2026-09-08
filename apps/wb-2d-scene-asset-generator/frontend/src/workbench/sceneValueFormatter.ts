import type { DomainValueFormatter } from '@forgeax/node-runtime-react/editor'

interface SceneNodeLike {
  path: string
  version: number
  schema?: string
  cells?: readonly unknown[]
  children?: readonly SceneNodeLike[]
}

interface ScenePortValueLike {
  tree: SceneNodeLike
  focus: string
}

interface SceneStats {
  totalNodes: number
  voxelCount: number
}

function parseScenePortValue(value: unknown): ScenePortValueLike | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ScenePortValueLike>
  if (typeof candidate.focus !== 'string') return null
  const tree = candidate.tree
  if (!tree || typeof tree !== 'object') return null
  if (typeof tree.path !== 'string' || typeof tree.version !== 'number') return null
  return { tree, focus: candidate.focus }
}

function readNode(root: SceneNodeLike, focus: string): SceneNodeLike | null {
  if (root.path === focus) return root
  for (const child of root.children ?? []) {
    const found = readNode(child, focus)
    if (found) return found
  }
  return null
}

function collectStats(node: SceneNodeLike, stats: SceneStats): void {
  stats.totalNodes += 1
  stats.voxelCount += node.cells?.length ?? 0
  for (const child of node.children ?? []) collectStats(child, stats)
}

function summarizeScene(value: unknown): {
  summary: string
  extra?: string
} | null {
  const port = parseScenePortValue(value)
  if (!port) return null
  const node = readNode(port.tree, port.focus)
  if (!node) return { summary: `scene focus="${port.focus}" (missing)` }

  const stats: SceneStats = { totalNodes: 0, voxelCount: 0 }
  collectStats(node, stats)
  const childCount = node.children?.length ?? 0
  const schemaPart = node.schema ? ` schema="${node.schema}"` : ''
  return {
    summary: `scene focus="${port.focus}"${schemaPart} voxels=${stats.voxelCount} children=${childCount} nodes=${stats.totalNodes}`,
    extra: `v=${node.version} own=${node.cells?.length ?? 0}`,
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
