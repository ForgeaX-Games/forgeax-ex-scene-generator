import { isNumericBuffer, type SceneNode, type SceneTree, transformMatrix, transformPoint, multiplyMatrices, IDENTITY_MATRIX, type Matrix4 } from '@forgeax/scene-authoring'
import { createSceneDiagnostic, diagnoseGeometry, type SceneDiagnostic } from '@forgeax/scene-authoring'

import { diagnoseRoadStructures, SCENE_ROAD_ADVISORY_CODES, SCENE_ROAD_FAIL_CODES } from './road.js'
import type { SceneCallRecord, SceneCallSource } from './host.js'

export const SCENE_SPATIAL_FAIL_CODES = [
  'SCENE_GROUND_MISALIGNED',
  'SCENE_FRAME_MISALIGNED',
  'SCENE_MESH_INTERSECTS',
  'SCENE_GEOMETRY_DEGENERATE',
  ...SCENE_ROAD_FAIL_CODES,
] as const

export const SCENE_SPATIAL_ADVISORY_CODES = [
  'SCENE_Z_CLEARANCE',
  'SCENE_NOT_ON_GROUND',
  'SCENE_NOT_ON_SURFACE',
  ...SCENE_ROAD_ADVISORY_CODES,
] as const

export const SCENE_SPATIAL_CODES = [
  ...SCENE_SPATIAL_FAIL_CODES,
  ...SCENE_SPATIAL_ADVISORY_CODES,
] as const

export type SceneSpatialCode = (typeof SCENE_SPATIAL_CODES)[number]

interface Aabb {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

interface PlacedMesh {
  positions: number[]
  indices?: number[]
  box: Aabb
  id: string
  name: string
  role?: string
  structure?: string
  part?: string
  source?: SceneCallSource
}

interface TerrainField {
  box: Aabb
  height: number[][]
  id: string
}

const LIST_CAP = 8
const CLIP_RATIO = 0.03
const TOUCH_M = 0.15
const MIN_LEN = 1e-4
const SIT_SLACK_M = 0.25
const TERRAIN_COVER_RATIO = 0.45
const OPERATING_BUILDERS = new Set([
  'point2d',
  'basePlane',
  'polyline2d',
  'spline2d',
  'polygon2d',
  'network2d',
  'point3d',
  'polyline3d',
  'spline3d',
  'polygon3d',
  'network3d',
  'liftToSurface',
])

function meshPositions(value: unknown): number[] | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as { positions?: unknown; mesh?: { positions?: unknown }; geometry?: { positions?: unknown } }
  if (isNumericBuffer(rec.positions) && rec.positions.length >= 3) return Array.from(rec.positions)
  if (rec.mesh && isNumericBuffer(rec.mesh.positions) && rec.mesh.positions.length >= 3) {
    return Array.from(rec.mesh.positions)
  }
  if (rec.geometry && isNumericBuffer(rec.geometry.positions) && rec.geometry.positions.length >= 3) {
    return Array.from(rec.geometry.positions)
  }
  return null
}

function meshIndices(value: unknown): number[] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as { indices?: unknown; mesh?: { indices?: unknown }; geometry?: { indices?: unknown } }
  if (isNumericBuffer(rec.indices) && rec.indices.length >= 3) return Array.from(rec.indices)
  if (rec.mesh && isNumericBuffer(rec.mesh.indices) && rec.mesh.indices.length >= 3) {
    return Array.from(rec.mesh.indices)
  }
  if (rec.geometry && isNumericBuffer(rec.geometry.indices) && rec.geometry.indices.length >= 3) {
    return Array.from(rec.geometry.indices)
  }
  return undefined
}

function aabbOf(positions: readonly number[]): Aabb | null {
  if (positions.length < 3) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

function overlapsXY(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function overlapsZ(a: Aabb, b: Aabb, slack: number): boolean {
  return a.minZ - slack <= b.maxZ && a.maxZ + slack >= b.minZ
}

function nodeName(args: Record<string, unknown>, id: string): string {
  return typeof args.name === 'string' && args.name.trim() ? args.name.trim() : `unnamed:${id}`
}

function roundBox(box: Aabb): Aabb {
  const r = (n: number) => Number(n.toFixed(1))
  return {
    minX: r(box.minX),
    maxX: r(box.maxX),
    minY: r(box.minY),
    maxY: r(box.maxY),
    minZ: r(box.minZ),
    maxZ: r(box.maxZ),
  }
}

function fmtBox(box: Aabb): string {
  const r = roundBox(box)
  return `x[${r.minX}, ${r.maxX}] y[${r.minY}, ${r.maxY}] z[${r.minZ}, ${r.maxZ}]`
}

function structureWhere(item: PlacedMesh): string {
  if (item.source?.file && item.source.line) return `${item.source.file}:${item.source.line}`
  if (item.source?.file) return item.source.file
  return item.id
}

function structureLabel(item: PlacedMesh): string {
  return `"${item.name}" (${structureWhere(item)})`
}

function listStructures(items: readonly PlacedMesh[]): string {
  const shown = items.slice(0, LIST_CAP).map(structureLabel)
  const extra = items.length > LIST_CAP ? `, and ${items.length - LIST_CAP} more` : ''
  return shown.join(', ') + extra
}

function structurePayload(items: readonly PlacedMesh[]) {
  return items.slice(0, 20).map((item) => ({
    name: item.name,
    statementId: item.id,
    ...(item.source?.file ? { file: item.source.file } : {}),
    ...(item.source?.line ? { line: item.source.line } : {}),
    aabb: roundBox(item.box),
  }))
}

function warn(
  code: SceneSpatialCode,
  message: string,
  items: readonly PlacedMesh[],
  terrainBox: Aabb,
  howToFix: string[],
): SceneDiagnostic {
  const first = items[0]!
  return createSceneDiagnostic({
    code,
    phase: 'execute',
    severity: 'warning',
    message,
    operation: 'sceneNode',
    source: {
      file: first.source?.file ?? 'main.scene.ts',
      start: 0,
      end: 0,
      line: first.source?.line ?? 1,
      column: first.source?.column ?? 1,
      statementId: first.id,
    },
    expected: { terrain: roundBox(terrainBox) },
    actual: { nodes: structurePayload(items) },
    howToFix,
  })
}

function xyArea(box: Aabb): number {
  return Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY)
}

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function clipPair(a: PlacedMesh, b: PlacedMesh): { ratio: number; overlapXY: number } | null {
  const ox = overlapLen(a.box.minX, a.box.maxX, b.box.minX, b.box.maxX)
  const oy = overlapLen(a.box.minY, a.box.maxY, b.box.minY, b.box.maxY)
  const oz = overlapLen(a.box.minZ, a.box.maxZ, b.box.minZ, b.box.maxZ)
  if (ox < TOUCH_M || oy < TOUCH_M || oz <= 0) return null
  const overlapXY = ox * oy
  const denom = Math.min(xyArea(a.box), xyArea(b.box))
  if (denom < MIN_LEN) return null
  const ratio = overlapXY / denom
  if (ratio < CLIP_RATIO) return null
  return { ratio, overlapXY }
}

function heightfieldBox(result: unknown): Aabb | null {
  if (!result || typeof result !== 'object') return null
  const rec = result as { heightfield?: unknown; geometry?: unknown; height?: unknown }
  const field = rec.heightfield && typeof rec.heightfield === 'object'
    ? rec.heightfield as { geometry?: unknown; height?: unknown }
    : rec
  const geom = field.geometry
  if (!geom || typeof geom !== 'object') return null
  const plane = geom as { origin?: number[]; width?: number; height?: number }
  const x0 = Number(plane.origin?.[0]) || 0
  const y0 = Number(plane.origin?.[1]) || 0
  const width = Number(plane.width)
  const depth = Number(plane.height)
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return null
  let minZ = 0
  let maxZ = 0
  const grid = field.height
  if (Array.isArray(grid)) {
    const values = (grid as number[][]).flat().map((cell) => Number(cell) || 0)
    if (values.length > 0) {
      minZ = Math.min(...values)
      maxZ = Math.max(...values)
    }
  }
  return { minX: x0, maxX: x0 + width, minY: y0, maxY: y0 + depth, minZ, maxZ }
}

function packetHeight(result: unknown): number[][] {
  if (!result || typeof result !== 'object') return []
  const rec = result as { heightfield?: unknown; height?: unknown }
  const field = rec.heightfield && typeof rec.heightfield === 'object'
    ? rec.heightfield as { height?: unknown }
    : rec
  return Array.isArray(field.height) ? field.height as number[][] : []
}

function hungRole(geometry: unknown): string | undefined {
  if (!geometry || typeof geometry !== 'object') return undefined
  const rec = geometry as { role?: unknown; mesh?: { role?: unknown } }
  if (typeof rec.role === 'string') return rec.role
  if (typeof rec.mesh?.role === 'string') return rec.mesh.role
  return undefined
}

function hungTag(args: Record<string, unknown>, key: 'structure' | 'part'): string | undefined {
  const fromArgs = args[key]
  if (typeof fromArgs === 'string' && fromArgs.trim()) return fromArgs.trim()
  const geometry = args.geometry
  if (!geometry || typeof geometry !== 'object') return undefined
  const rec = geometry as { structure?: unknown; part?: unknown; mesh?: { structure?: unknown; part?: unknown } }
  const direct = rec[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const nested = rec.mesh?.[key]
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  return undefined
}

function bilinear(grid: number[][], gx: number, gy: number): number {
  const rows = grid.length
  const columns = grid.reduce((max, row) => (Array.isArray(row) && row.length > max ? row.length : max), 0)
  if (rows === 0 || columns === 0) return 0
  const x0 = Math.max(0, Math.min(columns - 1, Math.floor(gx)))
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)))
  const x1 = Math.max(0, Math.min(columns - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(rows - 1, y0 + 1))
  const tx = Math.min(1, Math.max(0, gx - x0))
  const ty = Math.min(1, Math.max(0, gy - y0))
  const v00 = Number(grid[y0]?.[x0]) || 0
  const v10 = Number(grid[y0]?.[x1]) || 0
  const v01 = Number(grid[y1]?.[x0]) || 0
  const v11 = Number(grid[y1]?.[x1]) || 0
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
}

function sampleTerrainAt(field: TerrainField, x: number, y: number): number | null {
  const { box, height } = field
  if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) return null
  const rows = height.length
  const columns = height.reduce((max, row) => (Array.isArray(row) && row.length > max ? row.length : max), 0)
  if (rows === 0 || columns === 0) return null
  const spanX = box.maxX - box.minX
  const spanY = box.maxY - box.minY
  if (spanX <= 0 || spanY <= 0) return null
  const gx = (x - box.minX) / (spanX / columns) - 0.5
  const gy = (y - box.minY) / (spanY / rows) - 0.5
  return bilinear(height, gx, gy)
}

function resultGeometry(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result
  const rec = result as { geometry?: unknown }
  return rec.geometry ?? result
}

function operating3dPoints(value: unknown): Array<[number, number, number]> {
  if (!value || typeof value !== 'object') return []
  const rec = value as {
    kind?: unknown
    x?: unknown
    y?: unknown
    z?: unknown
    points?: unknown
    nodes?: unknown
  }
  const asXyz = (item: unknown): [number, number, number] | null => {
    if (Array.isArray(item) && item.length >= 3) {
      const x = Number(item[0])
      const y = Number(item[1])
      const z = Number(item[2])
      return [x, y, z].every(Number.isFinite) ? [x, y, z] : null
    }
    if (item && typeof item === 'object') {
      const point = item as { x?: unknown; y?: unknown; z?: unknown }
      const x = Number(point.x)
      const y = Number(point.y)
      const z = Number(point.z)
      return [x, y, z].every(Number.isFinite) ? [x, y, z] : null
    }
    return null
  }
  if (rec.kind === 'point3d') {
    const point = asXyz(rec)
    return point ? [point] : []
  }
  const list = Array.isArray(rec.points) ? rec.points : Array.isArray(rec.nodes) ? rec.nodes : []
  const points: Array<[number, number, number]> = []
  for (const item of list) {
    const point = asXyz(item)
    if (point) points.push(point)
  }
  return points
}

/**
 * Spatial reports after a TypeScript run. Geometry is authoring metres (x, y, z).
 * Fail codes flip verification.ok. Advisory codes do not.
 * Overpass / tunnel / variable-width corridors are not faults.
 */
/** Evaluate placement on the final instance hierarchy, not prototype construction calls. */
function finalPlacedMeshes(trace: readonly SceneCallRecord[]): PlacedMesh[] | undefined {
  const output=[...trace].reverse().find(call=>call.functionName==='sceneOutput')?.result as SceneTree | undefined
  if(!output || !output.graph || typeof (output.graph as {get?:unknown}).get!=='function') return undefined
  const graph=output.graph as {get(id:string):SceneNode|undefined}
  const sources=new Map<unknown,SceneCallRecord>()
  for(const call of trace) if(call.functionName==='sceneNode') {
    const scene=call.result as SceneTree
    if(scene?.graph && typeof (scene.graph as {get?:unknown}).get==='function') {
      const content=(scene.graph as {get(id:string):SceneNode|undefined}).get(scene.focus)?.content
      if(content && 'mesh' in content) sources.set(content.mesh,call)
    }
  }
  const result:PlacedMesh[]=[]
  const walk=(id:string,parent:Matrix4):void=>{
    const node=graph.get(id)
    if(!node) return
    const matrix=multiplyMatrices(parent,transformMatrix(node.transform))
    const mesh=node.content && 'mesh' in node.content ? node.content.mesh : undefined
    if(mesh) {
      const positions=Array.from(mesh.positions)
      for(let i=0;i+2<positions.length;i+=3) [positions[i],positions[i+1],positions[i+2]]=transformPoint(matrix,positions[i]!,positions[i+1]!,positions[i+2]!)
      const box=aabbOf(positions),call=sources.get(mesh)
      if(box) result.push({positions,indices:Array.from(mesh.indices),box,id:call?.id ?? id,name:node.name,role:mesh.role,structure:mesh.structure,part:mesh.part,source:call?.source})
    }
    const children=node.children instanceof Map ? [...node.children.values()] : Object.values(node.children)
    for(const child of children) walk(child,matrix)
  }
  walk(output.focus,IDENTITY_MATRIX)
  return result
}

export function diagnoseScenePlacement(trace: readonly SceneCallRecord[]): SceneDiagnostic[] {
  const terrain: TerrainField[] = []
  for (const call of trace) {
    if (call.functionName !== 'heightfield') continue
    const box = heightfieldBox(call.result)
    if (box) terrain.push({ box, height: packetHeight(call.result), id: call.id })
  }

  const finalPlaced = finalPlacedMeshes(trace)
  const placed: PlacedMesh[] = finalPlaced ?? []
  for (const call of finalPlaced ? [] : trace) {
    if (call.functionName !== 'sceneNode') continue
    const positions = meshPositions(call.args.geometry)
    if(positions && call.args.transform) {
      const matrix=transformMatrix(call.args.transform as import('@forgeax/scene-authoring').SceneTransform)
      for(let i=0;i+2<positions.length;i+=3) [positions[i],positions[i+1],positions[i+2]]=transformPoint(matrix,positions[i]!,positions[i+1]!,positions[i+2]!)
    }
    const box = positions ? aabbOf(positions) : null
    if (!positions || !box) continue
    placed.push({
      positions,
      indices: meshIndices(call.args.geometry),
      box,
      id: call.id,
      name: nodeName(call.args, call.id),
      role: hungRole(call.args.geometry),
      structure: hungTag(call.args, 'structure'),
      part: hungTag(call.args, 'part'),
      source: call.source,
    })
  }

  const diagnostics: SceneDiagnostic[] = []
  for (const call of trace) {
    if (!OPERATING_BUILDERS.has(call.functionName)) continue
    const fault = diagnoseGeometry(resultGeometry(call.result))
    if (!fault) continue
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_GEOMETRY_DEGENERATE',
      phase: 'execute',
      severity: 'warning',
      message: `${call.functionName}: ${fault.message}`,
      operation: call.functionName,
      source: {
        file: call.source?.file ?? 'main.scene.ts',
        start: 0,
        end: 0,
        line: call.source?.line ?? 1,
        column: call.source?.column ?? 1,
        statementId: call.id,
      },
      howToFix: ['Give the operating Geometry finite authoring-metre points. Width and use stay in the consuming module.'],
    }))
  }

  if (terrain.length > 0) {
    const offSurface: SceneCallRecord[] = []
    for (const call of trace) {
      if (!['point3d', 'polyline3d', 'spline3d', 'polygon3d', 'network3d', 'liftToSurface'].includes(call.functionName)) continue
      const points = operating3dPoints(resultGeometry(call.result))
      const miss = points.some(([x, y, z]) => {
        const overlapping = terrain.filter((field) => (
          x >= field.box.minX && x <= field.box.maxX && y >= field.box.minY && y <= field.box.maxY
        ))
        if (overlapping.length === 0) return false
        let sampled: number | null = null
        for (const field of overlapping) {
          sampled = sampleTerrainAt(field, x, y)
          if (sampled != null) break
        }
        return sampled != null && Math.abs(z - sampled) > SIT_SLACK_M
      })
      if (miss) offSurface.push(call)
    }
    if (offSurface.length > 0) {
      const first = offSurface[0]!
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_NOT_ON_SURFACE',
        phase: 'execute',
        severity: 'warning',
        message: `${offSurface.length} 3D operating Geometry value(s) sit in the Heightfield XY but Z is not on sampleHeight: ${offSurface.map((item) => item.functionName).join(', ')}. `
          + 'This is data, not a fault. liftToSurface uses a vertical sample; authored point3d may float.',
        operation: first.functionName,
        source: {
          file: first.source?.file ?? 'main.scene.ts',
          start: 0,
          end: 0,
          line: first.source?.line ?? 1,
          column: first.source?.column ?? 1,
          statementId: first.id,
        },
        howToFix: [
          'Call liftToSurface({ geometry, surface }) so Z comes from sampleHeight.',
          'If this is a flying curve, keep the authored Z.',
        ],
      }))
    }
  }

  const clips: Array<{ a: PlacedMesh; b: PlacedMesh; ratio: number; overlapXY: number }> = []
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const hit = clipPair(placed[i]!, placed[j]!)
      if (!hit) continue
      clips.push({ a: placed[i]!, b: placed[j]!, ...hit })
    }
  }
  if (clips.length > 0) {
    const first = clips[0]!
    const listed = clips.slice(0, LIST_CAP).map((item) => (
      `${structureLabel(item.a)} ∩ ${structureLabel(item.b)} (${(item.ratio * 100).toFixed(1)}%)`
    ))
    const extra = clips.length > LIST_CAP ? `, and ${clips.length - LIST_CAP} more` : ''
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_MESH_INTERSECTS',
      phase: 'execute',
      severity: 'warning',
      message: `${clips.length} hung mesh pair(s) occupy the same volume: ${listed.join('; ')}${extra}. `
        + 'Touching at a face is allowed; overlapping solids are not. '
        + 'A consuming module (street, building) must reserve space before hanging both meshes.',
      operation: 'sceneNode',
      source: {
        file: first.a.source?.file ?? 'main.scene.ts',
        start: 0,
        end: 0,
        line: first.a.source?.line ?? 1,
        column: first.a.source?.column ?? 1,
        statementId: first.a.id,
      },
      actual: {
        pairs: clips.slice(0, 20).map((item) => ({
          a: structurePayload([item.a])[0],
          b: structurePayload([item.b])[0],
          clipRatio: Number(item.ratio.toFixed(3)),
          overlapXY: Number(item.overlapXY.toFixed(2)),
        })),
      },
      howToFix: [
        'Select the leftover region of one operating Geometry before hanging the other mesh.',
        'Do not scatter two world-space meshes that claim the same XY and Z.',
      ],
    }))
  }

  diagnostics.push(...diagnoseRoadStructures(placed))

  if (terrain.length === 0 || placed.length === 0) return diagnostics

  const terrainBox = terrain[0]!.box
  const offGround = placed.filter((item) => !terrain.some((field) => overlapsXY(item.box, field.box)))
  if (offGround.length > 0) {
    diagnostics.push(warn(
      'SCENE_GROUND_MISALIGNED',
      `${offGround.length} sceneNode(s) sit outside the Heightfield terrain in XY: ${listStructures(offGround)}. `
        + `First AABB ${fmtBox(offGround[0]!.box)}; terrain ${fmtBox(terrainBox)}. `
        + 'Geometry vertices are authoring metres (x, y, z), the same as basePlane. '
        + 'Do not negate Y to match the renderer — Default flips Y once.',
      offGround,
      terrainBox,
      [
        'Open the named sceneNode and move its Geometry onto the terrain XY.',
        'Write (x, y, z) in authoring metres. Do not pre-flip Y.',
      ],
    ))
  }

  const terrainY = terrainBox.minY + terrainBox.maxY
  const flipped = placed.filter((item) => {
    const y = item.box.minY + item.box.maxY
    return Math.abs(terrainY) > 8 && Math.abs(y) > 8 && terrainY * y < 0
  })
  if (flipped.length > 0) {
    diagnostics.push(warn(
      'SCENE_FRAME_MISALIGNED',
      `${flipped.length} sceneNode(s) have the opposite Y sign from the terrain: ${listStructures(flipped)}. `
        + `First AABB ${fmtBox(flipped[0]!.box)}; terrain ${fmtBox(terrainBox)}. `
        + 'Write (x, y, z) in authoring metres. Pre-flipping Y puts the city on the wrong half-plane.',
      flipped,
      terrainBox,
      [
        'Remove the Y negation on the named Geometry.',
        'Keep vertices in authoring metres; Default flips Y once.',
      ],
    ))
  }

  const floating = placed.filter((item) => !terrain.some((field) => overlapsZ(item.box, field.box, 4)))
  if (floating.length > 0) {
    diagnostics.push(warn(
      'SCENE_Z_CLEARANCE',
      `${floating.length} sceneNode(s) have Z clearance from the terrain: ${listStructures(floating)}. `
        + `First AABB ${fmtBox(floating[0]!.box)}; terrain ${fmtBox(terrainBox)}. `
        + 'This is data, not a fault — overpass, tunnel, and thickness carving are valid. '
        + 'If the module meant to sit on the surface, placeOnGround({ geometry, heightfield, x, y }).',
      floating,
      terrainBox,
      [
        'If this should sit on the ground, call placeOnGround({ geometry, heightfield, x, y }).',
        'If this is an overpass or tunnel, keep the clearance.',
      ],
    ))
  }

  const notOnGround = placed.filter((item) => {
    if (item.role === 'terrain') return false
    if (floating.some((other) => other.id === item.id)) return false
    const overlapping = terrain.filter((field) => overlapsXY(item.box, field.box))
    if (overlapping.length === 0) return false
    if (overlapping.some((field) => xyArea(item.box) >= TERRAIN_COVER_RATIO * xyArea(field.box))) return false
    const cx = (item.box.minX + item.box.maxX) / 2
    const cy = (item.box.minY + item.box.maxY) / 2
    let sampled: number | null = null
    for (const field of overlapping) {
      sampled = sampleTerrainAt(field, cx, cy)
      if (sampled != null) break
    }
    if (sampled == null) return false
    return Math.abs(item.box.minZ - sampled) > SIT_SLACK_M
  })
  if (notOnGround.length > 0) {
    diagnostics.push(warn(
      'SCENE_NOT_ON_GROUND',
      `${notOnGround.length} sceneNode(s) overlap the terrain in XY but the mesh bottom is not on the Heightfield: ${listStructures(notOnGround)}. `
        + `First AABB ${fmtBox(notOnGround[0]!.box)}. `
        + 'This is data, not a fault — a pad, cellar, or stilts can be intentional. '
        + 'If the module meant to sit on the surface, placeOnGround({ geometry, heightfield, x, y }).',
      notOnGround,
      terrainBox,
      [
        'Call placeOnGround({ geometry, heightfield, x, y }) so the AABB floor sits on sampleHeight.',
        'If this is a raised pad or cellar, keep the clearance.',
      ],
    ))
  }

  return diagnostics
}

export function isSceneSpatialCode(code: string): code is SceneSpatialCode {
  return (SCENE_SPATIAL_CODES as readonly string[]).includes(code)
}

export function isSceneSpatialFailCode(code: string): boolean {
  return (SCENE_SPATIAL_FAIL_CODES as readonly string[]).includes(code)
}
