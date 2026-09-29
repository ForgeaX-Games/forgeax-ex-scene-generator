import { transformMatrix, multiplyMatrices, transformPoint, transformNormal, determinant3, IDENTITY_MATRIX, type Matrix4 } from '@forgeax/scene-authoring/scene-transform'
/**
 * Compose parent-local SceneGraph TRS into full world matrices.
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
  matrix?: Matrix4
}

export function isIdentityXform(xform: WorldXform): boolean {
  if (xform.matrix) return xform.matrix.every((value, index) => value === IDENTITY_MATRIX[index])
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

function fromMatrix(matrix: Matrix4): WorldXform {
  return { tx: matrix[12]!, ty: matrix[13]!, tz: matrix[14]!, yaw: Math.atan2(matrix[1]!, matrix[0]!), matrix }
}
export function matrixOfXform(xform: WorldXform): Matrix4 {
  return xform.matrix ?? transformMatrix({ pos: [xform.tx, xform.ty, xform.tz], quat: [0,0,Math.sin(xform.yaw/2),Math.cos(xform.yaw/2)] })
}
export function worldXformOf(graph: SceneGraph, id: NodeId): WorldXform {
  return relativeXformOf(graph, id, '')
}
export function localXformOf(graph: SceneGraph, id: NodeId): WorldXform {
  return fromMatrix(transformMatrix(graph.get(id)?.transform))
}
export function relativeXformOf(graph: SceneGraph, id: NodeId, rootId: NodeId): WorldXform {
  const chain: Transform[] = []
  for (let cur: string | null = id; cur && cur !== rootId;) {
    const node = graph.get(cur)
    if (!node) break
    if (node.transform) chain.push(node.transform)
    cur = node.parent
  }
  let matrix = IDENTITY_MATRIX
  for (const transform of chain.reverse()) matrix = multiplyMatrices(matrix, transformMatrix(transform))
  return fromMatrix(matrix)
}

/** Authoring (+Y) → renderer. Geometry vertices stay authoring; only the viewport flips. */
export function authoringToRendererXY(x: number, y: number): { x: number; y: number } {
  return { x, y: -y }
}

export function reverseTriangleWinding(indices: readonly number[]): number[] {
  const out = indices.slice()
  for (let i = 0; i + 2 < out.length; i += 3) {
    const mid = out[i + 1]!
    out[i + 1] = out[i + 2]!
    out[i + 2] = mid
  }
  return out
}

export function meshXyAabb(positions: readonly number[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (positions.length < 3) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY }
}

export function applyAuthoringXformToPositions(positions: readonly number[], xform: WorldXform): number[] {
  const matrix = matrixOfXform(xform), out = Array.from(positions)
  for (let i=0; i+2<out.length; i+=3) [out[i],out[i+1],out[i+2]] = transformPoint(matrix, positions[i]!,positions[i+1]!,positions[i+2]!)
  return out
}

export function sampleMeshZAtXy(positions: readonly number[], indices: readonly number[], x: number, y: number): number | null {
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!
    const b = indices[t + 1]!
    const c = indices[t + 2]!
    const ax = positions[a * 3]!
    const ay = positions[a * 3 + 1]!
    const az = positions[a * 3 + 2]!
    const bx = positions[b * 3]!
    const by = positions[b * 3 + 1]!
    const bz = positions[b * 3 + 2]!
    const cx = positions[c * 3]!
    const cy = positions[c * 3 + 1]!
    const cz = positions[c * 3 + 2]!
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(det) < 1e-12) continue
    const wB = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det
    const wC = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det
    const wA = 1 - wB - wC
    if (wA >= -1e-4 && wB >= -1e-4 && wC >= -1e-4) return wA * az + wB * bz + wC * cz
  }
  return null
}

export function alignPlacementXformToTerrain(
  xform: WorldXform,
  terrain: { positions: readonly number[]; indices?: readonly number[] } | null,
): WorldXform {
  if (!terrain?.indices) return xform
  const sampled = sampleMeshZAtXy(terrain.positions, terrain.indices, xform.tx, xform.ty)
  if (sampled == null || !Number.isFinite(sampled)) return xform
  if (xform.tz > 0 && xform.tz >= sampled - 0.5) return xform
  return { ...xform, tz: sampled, ...(xform.matrix ? { matrix: xform.matrix.map((value, index) => index === 14 ? sampled : value) } : {}) }
}

/** Authoring mesh + authoring xform → renderer vertices (Y flipped once). */
export function applyWorldXformToPositions(positions: readonly number[], xform: WorldXform): number[] {
  const authored = applyAuthoringXformToPositions(positions, xform)
  const out = authored.slice()
  for (let i = 0; i + 2 < out.length; i += 3) {
    out[i + 1] = -out[i + 1]!
  }
  return out
}

export function applyWorldXformToNormals(normals: readonly number[] | undefined, xform: WorldXform): number[] | undefined {
  if (!normals) return undefined
  const matrix=matrixOfXform(xform), out=Array.from(normals)
  for (let i=0; i+2<out.length; i+=3) {
    const [x,y,z]=transformNormal(matrix,normals[i]!,normals[i+1]!,normals[i+2]!)
    out[i]=x;out[i+1]=-y;out[i+2]=z
  }
  return out
}

export function authoringMeshToRenderer<T extends {
  positions: readonly number[]
  indices: readonly number[]
  normals?: readonly number[]
}>(mesh: T, xform: WorldXform): T {
  return {
    ...mesh,
    positions: applyWorldXformToPositions(mesh.positions, xform),
    indices: determinant3(matrixOfXform(xform)) < 0 ? Array.from(mesh.indices) : reverseTriangleWinding(mesh.indices),
    ...(mesh.normals ? { normals: applyWorldXformToNormals(mesh.normals, xform) } : {}),
  }
}

export function applyWorldXformToPoints(points: readonly GuidePoint[], xform: WorldXform): GuidePoint[] {
  if (isIdentityXform(xform)) return points.map((point) => ({ ...point }))
  const matrix=matrixOfXform(xform)
  return points.map(point=>{
    const [x,y,z]=transformPoint(matrix,point.x,point.y,point.z ?? 0)
    return {...point,x,y,...(point.z!==undefined || z!==0 ? {z}:{})}
  })
}

/** Undo `applyWorldXformToPoints` so a dragged world handle writes city-local Control metres. */
export function invertWorldXformToXY(x: number, y: number, xform: WorldXform): { x: number; y: number } {
  if (isIdentityXform(xform)) return { x, y }
  const m=matrixOfXform(xform), dx=x-m[12]!,dy=y-m[13]!
  const det=m[0]!*m[5]!-m[4]!*m[1]!
  if(Math.abs(det)<1e-12) throw new Error('Guide plane projects to a line; XY dragging is undefined')
  return {x:(dx*m[5]!-dy*m[4]!)/det,y:(dy*m[0]!-dx*m[1]!)/det}
}
