/**
 * addChild — graft SceneTree children under parent.focus.
 *
 * A SceneTree is a SceneTree. Named focus grafts that node (sceneNode leaf).
 * Unnamed root grafts its children (module tree from emptyScene + addChild).
 * Duplicate sibling names get _2 / _3.
 */

import {
  childrenOf,
  getNode,
  graftSubtrees,
  makeScenePort,
  parseScenePort,
  pathOf,
  type ScenePortValue,
} from '../../../../vendor/shared/types/index.js'

interface AddChildResult {
  scene?: ScenePortValue
  childPaths?: string[]
  error?: string
}

export function addChild(input: Record<string, unknown>): AddChildResult {
  const parent = parseScenePort(input.scene)
  if (!parent) return { error: 'scene (parent) is required and must be a SceneTree' }

  const parentNode = getNode(parent.graph, parent.focus)
  if (parentNode === null) {
    return { error: `parent path not found: "${parent.focus}"` }
  }

  const rawNodes = input.nodes
  if (!Array.isArray(rawNodes)) {
    return { error: 'nodes must be a list of SceneTree values' }
  }
  if (rawNodes.length === 0) {
    return { scene: makeScenePort(parent.graph, parent.focus), childPaths: [] }
  }

  const graph = parent.graph
  const pending: Parameters<typeof graftSubtrees>[2][number][] = []
  let nextOrder = 0
  const usedNames = new Set<string>(parentNode.children.keys())
  for (const existingId of parentNode.children.values()) {
    const existing = graph.get(existingId)
    if (existing && existing.order >= nextOrder) nextOrder = existing.order + 1
  }

  function dedupeName(base: string): string {
    if (!usedNames.has(base)) return base
    let suffix = 2
    while (usedNames.has(`${base}_${suffix}`)) suffix++
    return `${base}_${suffix}`
  }

  for (let i = 0; i < rawNodes.length; i++) {
    const sn = parseScenePort(rawNodes[i])
    if (!sn) return { error: `nodes[${i}] is not a valid SceneTree` }

    const subtree = getNode(sn.graph, sn.focus)
    if (subtree === null) {
      return { error: `nodes[${i}] focus "${sn.focus}" does not exist in its graph` }
    }
    const namedFocus = subtree.name.trim()
    const sources = namedFocus || subtree.transform || subtree.content || subtree.attributes
      ? [{ id: sn.focus, name: namedFocus || 'group' }]
      : childrenOf(sn.graph, sn.focus).map((child) => ({ id: child.id, name: child.name.trim() }))
    if (sources.length === 0) continue

    for (const src of sources) {
      if (!src.name) {
        return { error: `nodes[${i}] has an unnamed child; every grafted node needs a name` }
      }
      const name = dedupeName(src.name)
      usedNames.add(name)
      pending.push({name,graph:sn.graph,focus:src.id,order:nextOrder++})
    }
  }

  const result = graftSubtrees(graph, parent.focus, pending)
  return { scene: makeScenePort(result.graph, parent.focus), childPaths: result.ids.map(id => pathOf(result.graph,id)!) }
}
