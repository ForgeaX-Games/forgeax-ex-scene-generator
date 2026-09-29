import { isNumericBuffer } from '@forgeax/scene-authoring/scene-tree'
/**
 * sceneNode — hang Geometry as one SceneTree node.
 * kind mesh → mesh content; kind voxel → voxel content.
 * Plane is operating geometry, not scene content. Grid cannot enter the tree.
 */

import {
  ROOT_ID,
  addChildren,
  emptyScene,
  makeScenePort,
  meshContent,
  voxelContent,
  volumeFromCells,
  type Cell,
  type SceneMesh,
  type ScenePortValue,
  type Volume,
} from '../../../../vendor/shared/types/index.js'

interface SceneNodeResult {
  scene?: ScenePortValue
  schema?: 'mesh' | 'voxel'
  error?: string
}

function isMesh(value: unknown): value is SceneMesh {
  if (!value || typeof value !== 'object') return false
  const rec = value as { positions?: unknown; indices?: unknown }
  return isNumericBuffer(rec.positions) && isNumericBuffer(rec.indices)
}

function isVolume(value: unknown): value is Volume {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'empty' || kind === 'uniform' || kind === 'dense' || kind === 'sparse'
}

function peel(value: unknown): unknown {
  let cur = value
  for (let depth = 0; depth < 6; depth++) {
    if (Array.isArray(cur) && cur.length > 0) {
      const first = cur[0]
      if (first && typeof first === 'object' && Array.isArray((first as { items?: unknown }).items)) {
        const items = (first as { items: unknown[] }).items
        cur = items.length === 1 ? items[0] : items
        continue
      }
      if (cur.length === 1) {
        cur = first
        continue
      }
    }
    if (cur && typeof cur === 'object' && Array.isArray((cur as { items?: unknown }).items)) {
      const items = (cur as { items: unknown[] }).items
      cur = items.length === 1 ? items[0] : items
      continue
    }
    return cur
  }
  return cur
}

function parseCell(item: unknown, defaultToken: string): Cell | null {
  if (Array.isArray(item) && item.length >= 3) {
    const x = Number(item[0])
    const y = Number(item[1])
    const z = Number(item[2])
    if (![x, y, z].every(Number.isFinite)) return null
    const token = typeof item[3] === 'string' && item[3].trim() ? item[3].trim() : defaultToken
    return { x, y, z, token }
  }
  if (!item || typeof item !== 'object') return null
  const rec = item as { x?: unknown; y?: unknown; z?: unknown; token?: unknown }
  const x = Number(rec.x)
  const y = Number(rec.y)
  const z = Number(rec.z)
  if (![x, y, z].every(Number.isFinite)) return null
  const token = typeof rec.token === 'string' && rec.token.trim() ? rec.token.trim() : defaultToken
  return { x, y, z, token }
}

function parseCells(raw: unknown, defaultToken: string): Cell[] {
  if (!Array.isArray(raw)) return []
  const out: Cell[] = []
  for (const item of raw) {
    const cell = parseCell(item, defaultToken)
    if (cell) out.push(cell)
  }
  return out
}

function volumeFromGeometry(rec: Record<string, unknown>): Volume | null {
  if (isVolume(rec.volume)) return rec.volume
  if (rec.schema === 'voxel' && isVolume(rec.volume)) return rec.volume
  const cells = parseCells(rec.cells, 'cell')
  if (cells.length > 0) return volumeFromCells(cells)
  if (isVolume(rec)) return rec
  return null
}

export function sceneNode(input: Record<string, unknown>): SceneNodeResult {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { error: 'name is required' }
  if (rawName.includes('/')) return { error: "name must not contain '/'" }

  const geometry = peel(input.geometry)
  if (!geometry || typeof geometry !== 'object') {
    return { error: 'geometry is required (Geometry kind mesh or voxel)' }
  }
  const rec = geometry as Record<string, unknown>
  const structure = typeof input.structure === 'string' && input.structure.trim() ? input.structure.trim() : undefined
  const part = typeof input.part === 'string' && input.part.trim() ? input.part.trim() : undefined
  if (rec.type === 'heightfield' || rec.kind === 'heightfield' || (
    rec.heightfield && typeof rec.heightfield === 'object' && (rec.heightfield as { type?: unknown }).type === 'heightfield'
  )) {
    return { error: 'Heightfield packet is not scene content; weave with heightfieldMesh then hang the mesh' }
  }
  if (rec.kind === 'point2d' || rec.kind === 'point3d' || rec.kind === 'plane' || rec.kind === 'polyline' || rec.kind === 'polyline3d' || rec.kind === 'spline' || rec.kind === 'spline3d' || rec.kind === 'polygon' || rec.kind === 'polygon3d' || rec.kind === 'network' || rec.kind === 'network3d') {
    return { error: `${rec.kind} is operating geometry, not scene content; expand it in a .scene.ts then hang mesh or voxel` }
  }
  if ('grid' in rec && !isMesh(rec) && rec.kind !== 'mesh' && rec.kind !== 'voxel') {
    return { error: 'grid is a script value, not scene content' }
  }

  if (rec.kind === 'mesh' || isMesh(rec) || isMesh(rec.mesh) || isMesh(rec.geometry)) {
    const mesh = isMesh(rec) ? rec : isMesh(rec.mesh) ? rec.mesh : isMesh(rec.geometry) ? rec.geometry : null
    if (!mesh) return { error: 'geometry kind mesh is missing triangle data' }
    if(isMesh(rec) && (isMesh(rec.mesh)||isMesh(rec.geometry))) return {error:'geometry mesh must have exactly one payload source; use direct positions/indices or one nested mesh'}
    const tagged = !structure && !part ? mesh : {
      ...mesh,
      ...(structure ? { structure } : {}),
      ...(part ? { part } : {}),
    }
    const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
      { name: rawName, ...(typeof input.key === 'string' ? { key: input.key } : {}), ...(input.transform ? { transform: input.transform as import('@forgeax/scene-authoring/scene-tree').SceneTransform } : {}), schema: 'mesh', content: meshContent(tagged) },
    ])
    return { scene: makeScenePort(graph, ids[0]!), schema: 'mesh' }
  }

  if (rec.kind === 'voxel' || isVolume(rec) || isVolume(rec.volume)) {
    const volume = volumeFromGeometry(rec)
    if (!volume) return { error: 'geometry kind voxel is missing volume or cells' }
    const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
      { name: rawName, ...(typeof input.key === 'string' ? { key: input.key } : {}), ...(input.transform ? { transform: input.transform as import('@forgeax/scene-authoring/scene-tree').SceneTransform } : {}), schema: 'voxel', content: voxelContent(volume) },
    ])
    return { scene: makeScenePort(graph, ids[0]!), schema: 'voxel' }
  }

  return { error: 'geometry must be kind mesh or voxel' }
}
