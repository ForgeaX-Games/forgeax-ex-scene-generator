import { createSceneDiagnostic, type SceneDiagnostic } from '@forgeax/scene-authoring'

import type { SceneCallSource } from './host.js'

export const SCENE_ROAD_FAIL_CODES = [
  'SCENE_ROAD_PAVEMENT_SPLIT',
  'SCENE_ROAD_GRADE_FAULT',
] as const

export const SCENE_ROAD_ADVISORY_CODES = [
  'SCENE_ROAD_UNMARKED',
  'SCENE_ROAD_GRADE',
] as const

const GRADE_WARN = 0.18
const GRADE_FAIL = 0.35
const GRADE_CELL_M = 16
const CLUSTER_PAD_M = 8
const MIN_ISLAND_TRIS = 2
const LIST_CAP = 8

export interface RoadHungNode {
  id: string
  name: string
  positions: number[]
  indices?: number[]
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
  role?: string
  structure?: string
  part?: string
  source?: SceneCallSource
}

interface GradeHit {
  x: number
  y: number
  z: number
  slope: number
  spanM: number
  node: RoadHungNode
}

function where(node: RoadHungNode): string {
  if (node.source?.file && node.source.line) return `${node.source.file}:${node.source.line}`
  if (node.source?.file) return node.source.file
  return node.id
}

function label(node: RoadHungNode): string {
  return `"${node.name}" (${where(node)})`
}

function isRoad(node: RoadHungNode): boolean {
  return node.structure === 'road' || node.role === 'road'
}

function isPavement(node: RoadHungNode): boolean {
  if (!isRoad(node)) return false
  if (node.part === 'pavement') return true
  if (node.part) return false
  return !/pier|girder|shoulder|abutment/i.test(node.name)
}

function locate(node: RoadHungNode) {
  return {
    name: node.name,
    statementId: node.id,
    ...(node.source?.file ? { file: node.source.file } : {}),
    ...(node.source?.line ? { line: node.source.line } : {}),
  }
}

function roadSource(node: RoadHungNode) {
  return {
    file: node.source?.file ?? 'main.scene.ts',
    start: 0,
    end: 0,
    line: node.source?.line ?? 1,
    column: node.source?.column ?? 1,
    statementId: node.id,
  }
}

function overlaps(a: RoadHungNode, b: RoadHungNode, pad: number): boolean {
  return a.box.minX < b.box.maxX + pad
    && a.box.maxX + pad > b.box.minX
    && a.box.minY < b.box.maxY + pad
    && a.box.maxY + pad > b.box.minY
}

function clusters(nodes: readonly RoadHungNode[]): RoadHungNode[][] {
  const parent = nodes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!overlaps(nodes[i]!, nodes[j]!, CLUSTER_PAD_M)) continue
      const a = find(i)
      const b = find(j)
      if (a !== b) parent[b] = a
    }
  }
  const groups = new Map<number, RoadHungNode[]>()
  for (let i = 0; i < nodes.length; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(nodes[i]!)
    groups.set(root, list)
  }
  return [...groups.values()]
}

/**
 * Count triangle islands that share an edge (same vertex indices).
 * Nearby patches that only occupy the same XY cells are still split —
 * a network must be joined into one mesh, not tessellated per segment.
 * 0 = no usable triangles (not a driving surface).
 */
function triangleIslands(indices: readonly number[] | undefined): number {
  if (!indices || indices.length < 3) return 0
  const triCount = Math.floor(indices.length / 3)
  const parent = new Int32Array(triCount)
  for (let i = 0; i < triCount; i++) parent[i] = i
  const find = (i: number): number => {
    let x = i
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const edgeOwner = new Map<string, number>()
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3]!
    const b = indices[t * 3 + 1]!
    const c = indices[t * 3 + 2]!
    if (a === b || b === c || a === c) continue
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`
      const prev = edgeOwner.get(key)
      if (prev === undefined) edgeOwner.set(key, t)
      else unite(prev, t)
    }
  }
  const sizes = new Map<number, number>()
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3]!
    const b = indices[t * 3 + 1]!
    const c = indices[t * 3 + 2]!
    if (a === b || b === c || a === c) continue
    const root = find(t)
    sizes.set(root, (sizes.get(root) ?? 0) + 1)
  }
  let large = 0
  for (const size of sizes.values()) {
    if (size >= MIN_ISLAND_TRIS) large += 1
  }
  return large
}

function gradeHits(node: RoadHungNode): GradeHit[] {
  const pos = node.positions
  if (pos.length < 9) return []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 2 < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]!)
    maxX = Math.max(maxX, pos[i]!)
    minY = Math.min(minY, pos[i + 1]!)
    maxY = Math.max(maxY, pos[i + 1]!)
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / GRADE_CELL_M))
  const rows = Math.max(1, Math.ceil((maxY - minY) / GRADE_CELL_M))
  if (cols < 2 && rows < 2) return []
  const zSum = new Float64Array(cols * rows)
  const zCount = new Uint32Array(cols * rows)
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const c = Math.max(0, Math.min(cols - 1, Math.floor((pos[i]! - minX) / GRADE_CELL_M)))
    const r = Math.max(0, Math.min(rows - 1, Math.floor((pos[i + 1]! - minY) / GRADE_CELL_M)))
    const id = r * cols + c
    zSum[id] += pos[i + 2]!
    zCount[id] += 1
  }
  const zMean = new Float64Array(cols * rows).fill(NaN)
  for (let id = 0; id < zMean.length; id++) {
    if (zCount[id]! > 0) zMean[id] = zSum[id]! / zCount[id]!
  }
  const hits: GradeHit[] = []
  const consider = (c0: number, r0: number, c1: number, r1: number) => {
    const a = zMean[r0 * cols + c0]!
    const b = zMean[r1 * cols + c1]!
    if (!Number.isFinite(a) || !Number.isFinite(b)) return
    const span = Math.hypot((c1 - c0) * GRADE_CELL_M, (r1 - r0) * GRADE_CELL_M)
    if (!(span > 1)) return
    const slope = Math.abs(b - a) / span
    if (slope < GRADE_WARN) return
    hits.push({
      x: minX + (c0 + c1 + 1) * 0.5 * GRADE_CELL_M,
      y: minY + (r0 + r1 + 1) * 0.5 * GRADE_CELL_M,
      z: (a + b) / 2,
      slope,
      spanM: span,
      node,
    })
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) consider(c, r, c + 1, r)
      if (r + 1 < rows) consider(c, r, c, r + 1)
    }
  }
  hits.sort((a, b) => b.slope - a.slope)
  return hits
}

function gradePayload(hits: readonly GradeHit[]) {
  return hits.slice(0, 8).map((hit) => ({
    ...locate(hit.node),
    x: Number(hit.x.toFixed(1)),
    y: Number(hit.y.toFixed(1)),
    z: Number(hit.z.toFixed(1)),
    slope: Number(hit.slope.toFixed(3)),
    percent: Number((hit.slope * 100).toFixed(1)),
    spanM: Number(hit.spanM.toFixed(1)),
  }))
}

/**
 * Find hung road structure (sceneNode structure/part, or mesh.role fallback)
 * and check pavement triangle-edge continuity plus chord grade at GRADE_CELL_M.
 */
export function diagnoseRoadStructures(nodes: readonly RoadHungNode[]): SceneDiagnostic[] {
  const roads = nodes.filter(isRoad)
  if (roads.length === 0) return []
  const diagnostics: SceneDiagnostic[] = []

  const unmarked = roads.filter((item) => item.structure !== 'road')
  if (unmarked.length > 0) {
    const first = unmarked[0]!
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_ROAD_UNMARKED',
      phase: 'execute',
      severity: 'warning',
      message: `${unmarked.length} hung road mesh(es) have role "road" but no sceneNode structure annotation: ${unmarked.slice(0, LIST_CAP).map(label).join(', ')}. `
        + 'Authoring finds road structure via sceneNode({ structure: \'road\', part }). role is only the renderer bucket.',
      operation: 'sceneNode',
      source: roadSource(first),
      actual: { nodes: unmarked.slice(0, 20).map(locate) },
      howToFix: [
        'Hang pavement with sceneNode({ name, geometry, structure: \'road\', part: \'pavement\' }).',
        'Shoulder / girder / pier use part: \'shoulder\' | \'girder\' | \'pier\'. Do not invent a road Geometry kind.',
      ],
    }))
  }

  const pavement = roads.filter(isPavement)
  const splitGroups: Array<{ nodes: RoadHungNode[]; islands: number }> = []
  for (const group of clusters(pavement)) {
    if (group.length > 1) splitGroups.push({ nodes: group, islands: group.length })
  }
  for (const node of pavement) {
    const islands = triangleIslands(node.indices)
    if (islands !== 1) splitGroups.push({ nodes: [node], islands })
  }
  if (splitGroups.length > 0) {
    const first = splitGroups[0]!.nodes[0]!
    const listed = splitGroups.slice(0, LIST_CAP).map((group) => (
      group.nodes.length > 1
        ? group.nodes.map(label).join(' + ')
        : `${label(group.nodes[0]!)} has ${group.islands} triangle-connected pavement island(s)`
    ))
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_ROAD_PAVEMENT_SPLIT',
      phase: 'execute',
      severity: 'error',
      message: `${splitGroups.length} road pavement set(s) are not one driving surface: ${listed.join('; ')}. `
        + 'A network must join into one triangle-connected mesh (shared edges), not one strip or disk per segment.',
      operation: 'sceneNode',
      source: roadSource(first),
      actual: {
        groups: splitGroups.slice(0, 12).map((group) => ({
          islands: group.islands,
          nodes: group.nodes.map(locate),
        })),
      },
      howToFix: [
        'Build one pavement mesh for the whole network: offset-union the edges so triangles share edges, then hang it as part: \'pavement\'.',
        'Do not loft each network edge on its own, or stack a hub disk that does not share edges with the ribbons.',
        'Shoulder is part: \'shoulder\', stacked under the carriageway — not a second pavement piece.',
      ],
    }))
  }

  const warnHits: GradeHit[] = []
  const failHits: GradeHit[] = []
  for (const node of pavement) {
    for (const hit of gradeHits(node)) {
      if (hit.slope >= GRADE_FAIL) failHits.push(hit)
      else warnHits.push(hit)
    }
  }
  failHits.sort((a, b) => b.slope - a.slope)
  warnHits.sort((a, b) => b.slope - a.slope)

  if (failHits.length > 0) {
    const first = failHits[0]!
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_ROAD_GRADE_FAULT',
      phase: 'execute',
      severity: 'error',
      message: `${failHits.length} pavement chord(s) exceed ${(GRADE_FAIL * 100).toFixed(0)}% grade over ${GRADE_CELL_M} m. `
        + `Steepest ${(first.slope * 100).toFixed(1)}% at (${first.x.toFixed(1)}, ${first.y.toFixed(1)}, ${first.z.toFixed(1)}) on ${label(first.node)}.`,
      operation: 'sceneNode',
      source: roadSource(first.node),
      actual: { locations: gradePayload(failHits) },
      howToFix: [
        'Lengthen the landing / ease the designed grade so Δz / Δxy stays under 35% on a 16 m chord.',
        'Move terminals onto rims and keep the span chord high; do not dive the pavement into the valley.',
      ],
    }))
  }

  if (warnHits.length > 0) {
    const first = warnHits[0]!
    diagnostics.push(createSceneDiagnostic({
      code: 'SCENE_ROAD_GRADE',
      phase: 'execute',
      severity: 'warning',
      message: `${warnHits.length} pavement chord(s) are steeper than ${(GRADE_WARN * 100).toFixed(0)}% over ${GRADE_CELL_M} m. `
        + `Steepest ${(first.slope * 100).toFixed(1)}% at (${first.x.toFixed(1)}, ${first.y.toFixed(1)}, ${first.z.toFixed(1)}) on ${label(first.node)}. `
        + 'This is data, not a fail — mountain roads can be steep; above 35% is SCENE_ROAD_GRADE_FAULT.',
      operation: 'sceneNode',
      source: roadSource(first.node),
      actual: { locations: gradePayload(warnHits) },
      howToFix: [
        'If this should be a highway viaduct, flatten the grade between landings.',
        'If this is a steep path, keep it and treat the warning as location evidence.',
      ],
    }))
  }

  return diagnostics
}
