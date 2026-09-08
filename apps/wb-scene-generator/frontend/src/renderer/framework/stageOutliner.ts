import type { DisplayDrawable, DisplayIndex, DisplaySchema } from './displayIndex'

export { STAGE_BRANCHES, stagePathForSchema } from './stagePaths'
export type { StageBranch } from './stagePaths'

export interface StageOutlinerNode {
  path: string
  label: string
  schema: DisplaySchema
  layerKey?: string
  nodeId?: string
  children: StageOutlinerNode[]
}

export function buildStageOutliner(index: DisplayIndex): StageOutlinerNode[] {
  const rootNodes: StageOutlinerNode[] = []
  const nodeByPath = new Map<string, StageOutlinerNode>()

  // Sort drawables by path depth first, so parent paths come before child paths
  const sortedDrawables = [...index.drawables].sort((a, b) => a.path.localeCompare(b.path))

  for (const drawable of sortedDrawables) {
    const segments = drawable.path.replace(/^\//, '').split('/').filter(Boolean)
    if (segments.length === 0) continue

    let curPath = ''
    let parentNode: StageOutlinerNode | null = null

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      curPath = `${curPath}/${seg}`
      let node = nodeByPath.get(curPath)

      if (!node) {
        const isLeaf = i === segments.length - 1
        node = {
          path: curPath,
          label: isLeaf ? drawable.label : seg,
          schema: isLeaf ? drawable.schema : 'mesh',
          layerKey: isLeaf ? drawable.layerKey : undefined,
          nodeId: isLeaf ? drawable.nodeId : undefined,
          children: [],
        }
        nodeByPath.set(curPath, node)

        if (parentNode) {
          parentNode.children.push(node)
        } else {
          rootNodes.push(node)
        }
      } else if (i === segments.length - 1) {
        node.schema = drawable.schema
        node.layerKey = drawable.layerKey
        node.nodeId = drawable.nodeId
        node.label = drawable.label
      }

      parentNode = node
    }
  }

  return rootNodes
}

export function nodeIdsForOutlinerNode(node: StageOutlinerNode): string[] {
  if (node.layerKey) return [node.layerKey]
  if (node.nodeId) return [node.nodeId]
  return [...new Set(node.children.flatMap(nodeIdsForOutlinerNode))]
}

function leafFromDrawable(drawable: DisplayDrawable): StageOutlinerNode {
  return {
    path: drawable.path,
    label: drawable.label,
    schema: drawable.schema,
    layerKey: drawable.layerKey,
    nodeId: drawable.nodeId,
    children: [],
  }
}
