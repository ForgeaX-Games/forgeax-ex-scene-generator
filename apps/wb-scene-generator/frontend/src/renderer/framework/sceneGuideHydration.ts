/**
 * Pull Control polylines / point clouds off SceneGraph `points` prims.
 *
 * Preview otherwise only reads `points_to_node` ports. After compose, those
 * prims live under River / Plaza / Terrain and have no mesh port — without
 * this walk Default never builds handles, and clicking a mesh selects the
 * shared scene_output node (every prim highlights).
 */

import { childrenOf, pathOf, type NodeId, type SceneGraph } from '../../../../vendor/shared/types/scene/graph.js'
import { contentSchema } from '../../../../vendor/shared/types/scene/content.js'
import type { ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'
import type { GuidePoint, GuideStyle } from '../types'
import { parseGuidePoints, parseGuideStyle } from './guidePoints'
import { applyWorldXformToPoints, stageRootOf, worldXformOf } from './sceneWorldXform.js'

export interface SceneContentGuide {
  name: string
  path: string
  portName: string
  points: GuidePoint[]
  style: GuideStyle
}

export function inferGuideStyle(name: string, count: number, rawStyle?: unknown): GuideStyle {
  if (rawStyle !== undefined && rawStyle !== null && String(rawStyle).trim() !== '') {
    return parseGuideStyle(rawStyle)
  }
  if (count <= 1) return 'points'
  const n = name.toLowerCase()
  if (/(peak|center|plaza|marker|scatter)/.test(n)) return 'points'
  return 'polyline'
}

export function collectGuidesFromScene(port: ScenePortValue): SceneContentGuide[] {
  return collectGuidesFromGraph(port.graph, port.focus)
}

export function collectGuidesFromGraph(graph: SceneGraph, focus: NodeId): SceneContentGuide[] {
  const out: SceneContentGuide[] = []
  const walk = (id: NodeId): void => {
    const node = graph.get(id)
    if (!node) return
    const schema = node.schema || contentSchema(node.content)
    if (schema === 'points') {
      const raw = node.content && typeof node.content === 'object'
        ? (node.content as { points?: unknown }).points
        : undefined
      const points = parseGuidePoints(raw)
      if (points.length > 0) {
        const path = pathOf(graph, id) ?? `/${node.name}`
        const xform = worldXformOf(graph, id)
        const world = applyWorldXformToPoints(points, xform)
        out.push({
          name: node.name,
          path,
          portName: `points:${path}`,
          points: world.map((pt, i) => ({
            ...pt,
            localX: points[i]!.x,
            localY: points[i]!.y,
            parentTx: xform.tx,
            parentTy: xform.ty,
            parentYaw: xform.yaw,
          })),
          style: inferGuideStyle(node.name, points.length, node.attributes?.guideStyle),
        })
      }
    }
    for (const child of childrenOf(graph, id)) walk(child.id)
  }
  walk(stageRootOf(graph, focus))
  return out
}
