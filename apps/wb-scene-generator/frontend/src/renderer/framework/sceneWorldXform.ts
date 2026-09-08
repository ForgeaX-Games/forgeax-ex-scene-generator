/**
 * Compose SceneGraph local transforms into a world XY yaw + translation.
 *
 * Default preview used to copy mesh vertices as authored (prototypes at 0,0).
 * place() / instantiatePlacements write node.transform; this is the walk that
 * actually moves those prims in the viewport.
 */

import { type NodeId, type SceneGraph } from '../../../../vendor/shared/types/scene/graph.js'
import type { Transform } from '../../../../vendor/shared/types/scene/types.js'
import type { GuidePoint } from '../types'

export interface WorldXform {
  tx: number
  ty: number
  tz: number
  yaw: number
}

export function isIdentityXform(xform: WorldXform): boolean {
  return xform.tx === 0 && xform.ty === 0 && xform.tz === 0 && xform.yaw === 0
}

/** Walk to the in-graph root so Terrain is not dropped when scene_output focuses a placed child. */
export function stageRootOf(graph: SceneGraph, focus: NodeId): NodeId {
  let cur = focus
  for (;;) {
    const node = graph.get(cur)
    if (!node?.parent || !graph.get(node.parent)) return cur
    cur = node.parent
  }
}

export function worldXformOf(graph: SceneGraph, id: NodeId): WorldXform {
  const chain: Transform[] = []
  let cur: NodeId | null = id
  while (cur) {
    const node = graph.get(cur)
    if (!node) break
    if (node.transform) chain.push(node.transform)
    cur = node.parent
  }
  chain.reverse()
  let tx = 0
  let ty = 0
  let tz = 0
  let yaw = 0
  for (const transform of chain) {
    const [lx, ly, lz] = transform.translation ?? [0, 0, 0]
    const lyaw = transform.rotation?.[2] ?? 0
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    tx += c * lx - s * ly
    ty += s * lx + c * ly
    tz += lz
    yaw += lyaw
  }
  return { tx, ty, tz, yaw }
}

/** Local translation/yaw of one node, ignoring ancestors. Building parts author z from the prototype origin even when place() accidentally nested them. */
export function localXformOf(graph: SceneGraph, id: NodeId): WorldXform {
  const node = graph.get(id)
  const transform = node?.transform
  const [lx, ly, lz] = transform?.translation ?? [0, 0, 0]
  return { tx: lx, ty: ly, tz: lz, yaw: transform?.rotation?.[2] ?? 0 }
}

export function relativeXformOf(graph: SceneGraph, id: NodeId, rootId: NodeId): WorldXform {
  const chain: Transform[] = []
  let cur: NodeId | null = id
  while (cur && cur !== rootId) {
    const node = graph.get(cur)
    if (!node) break
    if (node.transform) chain.push(node.transform)
    cur = node.parent
  }
  chain.reverse()
  let tx = 0
  let ty = 0
  let tz = 0
  let yaw = 0
  for (const transform of chain) {
    const [lx, ly, lz] = transform.translation ?? [0, 0, 0]
    const lyaw = transform.rotation?.[2] ?? 0
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    tx += c * lx - s * ly
    ty += s * lx + c * ly
    tz += lz
    yaw += lyaw
  }
  return { tx, ty, tz, yaw }
}

/** Authoring (+Y) → renderer (Y flipped), same frame as heightfield / ribbon meshes. */
export function authoringToRendererXY(x: number, y: number): { x: number; y: number } {
  return { x, y: -y }
}

export function applyWorldXformToPositions(positions: readonly number[], xform: WorldXform): number[] {
  if (isIdentityXform(xform)) return positions.slice()
  // Scene-graph translation is authoring metres (+Y). Mesh vertices are already
  // in renderer space (Y flipped, same as heightfield / gridToBoxes).
  const { x: tx, y: ty } = authoringToRendererXY(xform.tx, xform.ty)
  const yaw = -xform.yaw
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const out = positions.slice()
  for (let i = 0; i + 2 < out.length; i += 3) {
    const x = out[i]!
    const y = out[i + 1]!
    const z = out[i + 2]!
    out[i] = tx + c * x - s * y
    out[i + 1] = ty + s * x + c * y
    out[i + 2] = xform.tz + z
  }
  return out
}

export function applyWorldXformToNormals(normals: readonly number[] | undefined, xform: WorldXform): number[] | undefined {
  if (!normals || xform.yaw === 0) return normals ? normals.slice() : undefined
  const yaw = -xform.yaw
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const out = normals.slice()
  for (let i = 0; i + 2 < out.length; i += 3) {
    const x = out[i]!
    const y = out[i + 1]!
    out[i] = c * x - s * y
    out[i + 1] = s * x + c * y
  }
  return out
}

export function applyWorldXformToPoints(points: readonly GuidePoint[], xform: WorldXform): GuidePoint[] {
  if (isIdentityXform(xform)) return points.map((point) => ({ ...point }))
  const c = Math.cos(xform.yaw)
  const s = Math.sin(xform.yaw)
  return points.map((point) => ({
    ...point,
    x: xform.tx + c * point.x - s * point.y,
    y: xform.ty + s * point.x + c * point.y,
    ...(point.z !== undefined ? { z: xform.tz + point.z } : {}),
  }))
}

/** Undo `applyWorldXformToPoints` so a dragged world handle writes city-local Control metres. */
export function invertWorldXformToXY(x: number, y: number, xform: WorldXform): { x: number; y: number } {
  if (isIdentityXform(xform)) return { x, y }
  const dx = x - xform.tx
  const dy = y - xform.ty
  const c = Math.cos(-xform.yaw)
  const s = Math.sin(-xform.yaw)
  return { x: c * dx - s * dy, y: s * dx + c * dy }
}
