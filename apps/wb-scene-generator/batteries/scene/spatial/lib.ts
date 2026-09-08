import {
  addChildren,
  childrenOf,
  getNode,
  graftSubtree,
  makeScenePort,
  parseScenePort,
  pathOf,
  setTransform,
  type ScenePortValue,
} from '../../../vendor/dist/shared/types/index.js'
import {
  makePlane,
  makeWorkGrid,
  planePointToWorld,
  type Placement,
  type PlacementSet,
  type Plane,
  type WorkGrid,
} from '../../../vendor/shared/types/scene/spatial.js'

export function asPlane(value: unknown): Plane | null {
  if (!value || typeof value !== 'object') return null
  const plane = value as Plane
  if (!Array.isArray(plane.origin) || !Array.isArray(plane.xAxis) || !Array.isArray(plane.yAxis)) return null
  if (!Number.isFinite(plane.width) || !Number.isFinite(plane.height)) return null
  return plane
}

export function asWorkGrid(value: unknown): WorkGrid | null {
  if (!value || typeof value !== 'object') return null
  const grid = value as WorkGrid
  if (!asPlane(grid.plane) || !Number.isFinite(grid.cellSize)) return null
  return grid
}

export function asPlacementSet(value: unknown): PlacementSet | null {
  if (!value || typeof value !== 'object') return null
  const set = value as PlacementSet
  if (!Array.isArray(set.placements)) return null
  return set
}

export function basePlaneOp(input: Record<string, unknown>): { plane: Plane; error?: string } {
  const width = Number(input.width ?? 2000)
  const height = Number(input.height ?? 2000)
  const x = Number(input.x ?? 0)
  const y = Number(input.y ?? 0)
  const z = Number(input.z ?? 0)
  if (![width, height, x, y, z].every(Number.isFinite)) return { plane: makePlane(1, 1), error: 'basePlane requires finite metres' }
  return { plane: makePlane(width, height, [x, y, z]) }
}

export function workGridOp(input: Record<string, unknown>): { grid: WorkGrid; error?: string } {
  const plane = asPlane(input.plane)
  if (!plane) return { grid: makeWorkGrid(makePlane(1, 1), 1), error: 'workGrid requires a Plane' }
  const cellSize = Number(input.cellSize ?? 1)
  if (!Number.isFinite(cellSize) || cellSize <= 0) return { grid: makeWorkGrid(plane, 1), error: 'cellSize must be a positive metre size' }
  return { grid: makeWorkGrid(plane, cellSize) }
}

export function extractPlaneOp(input: Record<string, unknown>): { plane: Plane; error?: string } {
  const explicit = asPlane(input.plane)
  if (explicit) return { plane: explicit }
  const width = Number(input.width ?? 600)
  const height = Number(input.height ?? 450)
  const x = Number(input.x ?? 0)
  const y = Number(input.y ?? 0)
  return { plane: makePlane(width, height, [x, y, 0]) }
}

export function placeOp(input: Record<string, unknown>): { scene?: ScenePortValue; localOrigin?: readonly [number, number]; error?: string } {
  const parent = parseScenePort(input.scene)
  const child = parseScenePort(input.child)
  if (!parent || !child) return { error: 'place requires parent and child scenes' }
  const name = typeof input.name === 'string' && input.name ? input.name : 'placed'
  const x = Number(input.x ?? 0)
  const y = Number(input.y ?? 0)
  const z = Number(input.z ?? 0)
  if (![x, y, z].every(Number.isFinite)) return { error: 'place origin must be finite child-local metres' }
  try {
    const grafted = graftSubtree(parent.graph, parent.focus, name, child.graph, child.focus)
    const graph = setTransform(grafted.graph, grafted.id, { translation: [x, y, z] })
    // Stay on the host so chained place() calls add siblings (foundation / wall /
    // roof) instead of nesting each part under the previous one and stacking Z.
    return {
      scene: makeScenePort(graph, parent.focus),
      localOrigin: [x, y],
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function prototypeCatalogOp(input: Record<string, unknown>): { catalog: Record<string, unknown>; keys: string[] } {
  const catalog: Record<string, unknown> = {}
  const keys = Array.isArray(input.keys) ? input.keys.map(String) : []
  const raw = input.prototypes
  if (Array.isArray(raw)) {
    raw.forEach((value, index) => {
      catalog[keys[index] ?? `prototype-${index}`] = value
    })
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) catalog[key] = value
  }
  for (const [name, value] of Object.entries(input)) {
    const match = /^prototypes_(\d+)$/.exec(name)
    if (!match) continue
    const index = Number(match[1])
    catalog[keys[index] ?? `prototype-${index}`] = value
  }
  return { catalog, keys: keys.length ? keys : Object.keys(catalog).sort() }
}

/** Authoring metres stay +Y. Preview applies one Y-flip onto heightfield / ribbon vertices. */
export function authoringPlacementTranslation(placement: Pick<Placement, 'x' | 'y' | 'z'>): readonly [number, number, number] {
  return [placement.x, placement.y, placement.z ?? 0]
}

function findPrototypeRoot(graph: any, focus: string): string {
  let cur = focus
  for (;;) {
    const node = graph.get(cur)
    if (!node?.parent || node.parent === 'root' || !graph.get(node.parent)) return cur
    cur = node.parent
  }
}

export function instantiatePlacementsOp(input: Record<string, unknown>): { scene?: ScenePortValue; count?: number; error?: string } {
  const parent = parseScenePort(input.scene)
  if (!parent) return { error: 'instantiatePlacements requires a host scene' }
  const catalog = (input.catalog && typeof input.catalog === 'object' ? input.catalog : {}) as Record<string, unknown>
  const placements = asPlacementSet(input.placements)?.placements ?? (Array.isArray(input.placements) ? input.placements as Placement[] : [])
  let graph = parent.graph
  const host = getNode(graph, parent.focus)
  if (!host) return { error: 'instantiatePlacements host is missing' }

  let protoFolderId = [...childrenOf(graph, parent.focus)].find((child) => child.name === 'Prototypes')?.id
  if (!protoFolderId) {
    const added = addChildren(graph, parent.focus, [{ name: 'Prototypes', schema: 'scope' }])
    graph = added.graph
    protoFolderId = added.ids[0]
  }
  const installed = new Set(
    protoFolderId ? [...childrenOf(graph, protoFolderId)].map((child) => child.name) : [],
  )
  for (const placement of placements) {
    if (installed.has(placement.prototypeKey)) continue
    const proto = parseScenePort(catalog[placement.prototypeKey])
    if (!proto || !protoFolderId) continue
    try {
      const rootId = findPrototypeRoot(proto.graph, proto.focus)
      const grafted = graftSubtree(graph, protoFolderId, placement.prototypeKey, proto.graph, rootId)
      graph = grafted.graph
      installed.add(placement.prototypeKey)
    } catch {
      // Catalog key already present from a previous instantiate pass.
    }
  }

  let count = 0
  for (const placement of placements) {
    if (!installed.has(placement.prototypeKey)) continue
    try {
      const added = addChildren(graph, parent.focus, [{
        name: placement.key,
        schema: 'ref',
        attributes: { prototypeKey: placement.prototypeKey },
        content: { schema: 'ref', module: placement.prototypeKey },
        transform: {
          translation: authoringPlacementTranslation(placement),
          rotation: [0, 0, placement.rotation],
          ...(placement.scale ? { scale: placement.scale } : {}),
        },
      }])
      graph = added.graph
      count += 1
    } catch {
      // Skip colliding keys rather than aborting a city-scale instance set.
    }
  }
  return { scene: makeScenePort(graph, parent.focus), count }
}

export function controlWorldPosition(plane: Plane, x: number, y: number): readonly [number, number, number] {
  return planePointToWorld(plane, x, y)
}

export { getNode, pathOf }
