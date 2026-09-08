// 💡 3DMesh heightfield builder — local to this mode (no other-mode imports).
//
// Pipeline:
//   tile samples → surface owners → corner-averaged heights
//   → subdivided heightfield → isotropic (shortest-diagonal) tris → mesh
// Asset mode: 4-way splat (per-cell assetName → RGBA weights + multi PBR).

import * as THREE from 'three'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { gridCornerToWorld } from '../../framework/geometry/worldCoordinates'
import { colorForValue, type RGBA } from '../../framework/palette'
import { splatUvAtCorner, type SplatField } from './buildSplatField'
import { createSplatMaterial } from './createSplatMaterial'
import type { LoadedPbrMaps } from './loadPbrTextures'
import { pushIsotropicQuad } from '../../../../../vendor/shared/types/scene/heightfield'
import {
  buildSurfaceField,
  cellKey,
  pickDominantOwner,
  type SurfaceField,
  type SurfaceOwner,
  type TileCellSample,
} from './surfaceOwner'

export { pushIsotropicQuad }

/** Subdivide each voxel cell into N×N micro-quads (smoother ridges, less anisotropic slivers). */
export const TERRAIN_SUBDIV = 2

export interface TerrainSplatInput {
  splatField: SplatField
  controlMap: THREE.Texture
  layers: Array<LoadedPbrMaps | null>
}

export interface BuildTerrainMeshOpts {
  samples: ReadonlyArray<TileCellSample>
  selectedEditorNodeIds?: ReadonlySet<string> | ReadonlyArray<string>
  wireframe: boolean
  colorMode: boolean
  /** @deprecated single-material path; prefer splat */
  pbrMaps?: LoadedPbrMaps | null
  /** Multi-material splat (Asset mode). */
  splat?: TerrainSplatInput | null
}

export interface TerrainMeshStats {
  ownerCount: number
  vertexCount: number
  triangleCount: number
  dominantAssetName: string | null
}

export function ownerTopZ(owner: Pick<SurfaceOwner, 'z'>, cellSize = BASE_CELL_SIZE): number {
  return (owner.z + 1) * cellSize
}

export function dominantAssetName(samples: ReadonlyArray<TileCellSample>): string | null {
  const field = buildSurfaceField(samples)
  const o = pickDominantOwner(field)
  const name = o?.assetName?.trim() ?? ''
  return name.length > 0 ? name : null
}

function selectedSet(ids: BuildTerrainMeshOpts['selectedEditorNodeIds']): Set<string> {
  if (!ids) return new Set()
  return ids instanceof Set ? ids : new Set(ids)
}

function ownerColor(owner: SurfaceOwner, selected: Set<string>): RGBA {
  return colorForValue(owner.value, { selected: selected.has(owner.nodeId) })
}

function cornerHeight(
  field: SurfaceField,
  ix: number,
  iy: number,
  cellSize: number,
): number | null {
  const cells: Array<[number, number]> = [
    [ix - 1, iy - 1],
    [ix, iy - 1],
    [ix - 1, iy],
    [ix, iy],
  ]
  let sum = 0
  let n = 0
  for (const [cx, cy] of cells) {
    if (cx < field.minX || cx > field.maxX || cy < field.minY || cy > field.maxY) continue
    const o = field.owners.get(cellKey(cx, cy))
    if (!o) continue
    sum += ownerTopZ(o, cellSize)
    n++
  }
  return n === 0 ? null : sum / n
}

function cornerColor(
  field: SurfaceField,
  ix: number,
  iy: number,
  selected: Set<string>,
): RGBA | null {
  const order: Array<[number, number]> = [
    [ix, iy],
    [ix - 1, iy],
    [ix, iy - 1],
    [ix - 1, iy - 1],
  ]
  for (const [cx, cy] of order) {
    const o = field.owners.get(cellKey(cx, cy))
    if (o) return ownerColor(o, selected)
  }
  return null
}

function worldXY(cellX: number, cellY: number, cellSize: number): { x: number; y: number } {
  const world = gridCornerToWorld(cellX, cellY)
  return { x: world.x * cellSize, y: world.y * cellSize }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function bilerp(h00: number, h10: number, h01: number, h11: number, fx: number, fy: number): number {
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy)
}

/** One Laplacian pass on a dense height grid; preserves strong cliffs. */
function smoothHeights(
  heights: Array<number | null>,
  vertsX: number,
  vertsY: number,
  strength = 0.4,
): void {
  const next = heights.slice()
  for (let j = 1; j < vertsY - 1; j++) {
    for (let i = 1; i < vertsX - 1; i++) {
      const idx = j * vertsX + i
      const h = heights[idx]
      if (h === null || h === undefined) continue
      const n: number[] = []
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const hh = heights[(j + dj) * vertsX + (i + di)]
        if (hh !== null && hh !== undefined) n.push(hh)
      }
      if (n.length < 3) continue
      const avg = n.reduce((a, b) => a + b, 0) / n.length
      const maxDelta = Math.max(...n.map((v) => Math.abs(v - h)))
      // Don't melt real cliffs (large neighbor jumps).
      if (maxDelta > BASE_CELL_SIZE * 0.85) continue
      next[idx] = lerp(h, avg, strength)
    }
  }
  for (let k = 0; k < heights.length; k++) heights[k] = next[k]!
}

function buildVertexColorMaterial(opts: BuildTerrainMeshOpts): THREE.Material {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: false,
    wireframe: opts.wireframe,
    transparent: opts.wireframe,
    opacity: opts.wireframe ? 0.55 : 1,
    side: THREE.DoubleSide,
  })
}

function buildSinglePbrMaterial(pbr: LoadedPbrMaps, wireframe: boolean): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({
    map: pbr.map,
    normalMap: pbr.normalMap,
    roughnessMap: pbr.roughnessMap,
    aoMap: pbr.aoMap,
    roughness: pbr.roughnessMap ? 1 : 0.85,
    metalness: 0,
    wireframe,
    side: THREE.DoubleSide,
  })
  if (pbr.normalSpace === 'DX' && mat.normalScale) mat.normalScale.y = -1
  const tiling = pbr.tiling
  for (const tex of [pbr.map, pbr.normalMap, pbr.roughnessMap, pbr.aoMap]) {
    if (!tex) continue
    tex.repeat.set(tiling, tiling)
    tex.needsUpdate = true
  }
  return mat
}

/**
 * Build a single terrain Mesh from tile samples. Returns null when empty.
 * Caller owns dispose via disposeTerrainMesh.
 */
export function buildTerrainMesh(opts: BuildTerrainMeshOpts): THREE.Mesh | null {
  const field = buildSurfaceField(opts.samples)
  if (field.owners.size === 0) return null

  const cellSize = BASE_CELL_SIZE
  const selected = selectedSet(opts.selectedEditorNodeIds)
  const { minX, maxX, minY, maxY } = field
  const useSplat = !!(opts.splat && !opts.wireframe)
  const useSinglePbr = !!(!useSplat && opts.pbrMaps?.map && !opts.wireframe)

  const cols = maxX - minX + 1
  const rows = maxY - minY + 1
  const subdiv = TERRAIN_SUBDIV
  const coarseVX = cols + 1
  const coarseVY = rows + 1

  const coarseH: Array<number | null> = new Array(coarseVX * coarseVY)
  const coarseC: Array<RGBA | null> = new Array(coarseVX * coarseVY)
  for (let j = 0; j < coarseVY; j++) {
    for (let i = 0; i < coarseVX; i++) {
      const ix = minX + i
      const iy = minY + j
      const idx = j * coarseVX + i
      coarseH[idx] = cornerHeight(field, ix, iy, cellSize)
      coarseC[idx] = cornerColor(field, ix, iy, selected)
    }
  }

  // Dense heightfield: bilinear sample of coarse corners, then light smooth.
  const vertsX = cols * subdiv + 1
  const vertsY = rows * subdiv + 1
  const heights: Array<number | null> = new Array(vertsX * vertsY)
  const colors: Array<RGBA | null> = new Array(vertsX * vertsY)

  for (let j = 0; j < vertsY; j++) {
    for (let i = 0; i < vertsX; i++) {
      const idx = j * vertsX + i
      const u = i / subdiv
      const v = j / subdiv
      const i0 = Math.floor(u)
      const j0 = Math.floor(v)
      const i1 = Math.min(i0 + 1, cols)
      const j1 = Math.min(j0 + 1, rows)
      const fx = u - i0
      const fy = v - j0
      const h00 = coarseH[j0 * coarseVX + i0]
      const h10 = coarseH[j0 * coarseVX + i1]
      const h01 = coarseH[j1 * coarseVX + i0]
      const h11 = coarseH[j1 * coarseVX + i1]
      if (h00 == null || h10 == null || h01 == null || h11 == null) {
        // Boundary / sparse: take any available neighbor average.
        const avail = [h00, h10, h01, h11].filter((x): x is number => x != null)
        heights[idx] = avail.length ? avail.reduce((a, b) => a + b, 0) / avail.length : null
      } else {
        heights[idx] = bilerp(h00, h10, h01, h11, fx, fy)
      }
      // Nearest coarse corner color (stable for selection tint).
      const ci = Math.min(Math.round(u), cols)
      const cj = Math.min(Math.round(v), rows)
      colors[idx] = coarseC[cj * coarseVX + ci]
    }
  }
  smoothHeights(heights, vertsX, vertsY, 0.45)
  smoothHeights(heights, vertsX, vertsY, 0.3)

  const positions: number[] = []
  const uvs: number[] = []
  const splatUvs: number[] = []
  const vertexColors: number[] = []
  const indices: number[] = []
  const vertIndex = new Map<number, number>()

  const ensureVert = (i: number, j: number): number | null => {
    const linear = j * vertsX + i
    const cached = vertIndex.get(linear)
    if (cached !== undefined) return cached
    const h = heights[linear]
    if (h === null || h === undefined) return null
    const c = colors[linear] ?? { r: 180, g: 180, b: 180, a: 255 }
    const cellXF = minX + i / subdiv
    const cellYF = minY + j / subdiv
    const { x: wx, y: wy } = worldXY(cellXF, cellYF, cellSize)
    const meshIdx = positions.length / 3
    positions.push(wx, wy, h)
    uvs.push(wx / cellSize, wy / cellSize)
    const [su, sv] = splatUvAtCorner(i / subdiv, j / subdiv, cols, rows)
    splatUvs.push(su, sv)
    vertexColors.push(c.r / 255, c.g / 255, c.b / 255)
    vertIndex.set(linear, meshIdx)
    return meshIdx
  }

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const owner = field.owners.get(cellKey(minX + i, minY + j))
      if (!owner) continue

      for (let sj = 0; sj < subdiv; sj++) {
        for (let si = 0; si < subdiv; si++) {
          const fi = i * subdiv + si
          const fj = j * subdiv + sj
          const i00 = ensureVert(fi, fj)
          const i10 = ensureVert(fi + 1, fj)
          const i01 = ensureVert(fi, fj + 1)
          const i11 = ensureVert(fi + 1, fj + 1)
          if (i00 === null || i10 === null || i01 === null || i11 === null) continue
          pushIsotropicQuad(indices, positions, i00, i10, i01, i11)
        }
      }
    }
  }

  if (indices.length === 0) return null

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  if (useSplat) {
    geom.setAttribute('splatUv', new THREE.Float32BufferAttribute(splatUvs, 2))
  } else if (useSinglePbr) {
    geom.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs.slice(), 2))
  } else {
    geom.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3))
  }
  geom.setIndex(indices)
  geom.computeVertexNormals()

  let material: THREE.Material
  let splatDisposeExtra: (() => void) | undefined
  let meshNeedsWaterAnim = false
  if (useSplat && opts.splat) {
    let heightMin = Infinity
    let heightMax = -Infinity
    for (let p = 2; p < positions.length; p += 3) {
      const z = positions[p]!
      if (z < heightMin) heightMin = z
      if (z > heightMax) heightMax = z
    }
    if (!Number.isFinite(heightMin)) {
      heightMin = 0
      heightMax = 8
    } else if (heightMax - heightMin < 1e-3) {
      heightMax = heightMin + 1
    }
    const handle = createSplatMaterial(opts.splat.controlMap, opts.splat.layers, {
      heightMin,
      heightMax,
    })
    material = handle.material
    // controlMap + layer textures are owned by the React splat state — only
    // dispose shader dummy textures here.
    splatDisposeExtra = handle.disposeExtra
    meshNeedsWaterAnim = handle.needsWaterAnim
  } else if (useSinglePbr && opts.pbrMaps) {
    material = buildSinglePbrMaterial(opts.pbrMaps, opts.wireframe)
  } else {
    material = buildVertexColorMaterial(opts)
  }

  const mesh = new THREE.Mesh(geom, material)
  mesh.name = 'terrain-3dmesh'
  mesh.frustumCulled = false
  if (splatDisposeExtra) mesh.userData.splatDisposeExtra = splatDisposeExtra
  mesh.userData.needsWaterAnim = meshNeedsWaterAnim
  void opts.colorMode
  return mesh
}

export function disposeTerrainMesh(mesh: THREE.Mesh): void {
  const extra = mesh.userData.splatDisposeExtra as (() => void) | undefined
  extra?.()
  mesh.userData.splatDisposeExtra = undefined
  mesh.geometry.dispose()
  const mat = mesh.material
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
  else mat.dispose()
}

export function terrainMeshStats(samples: ReadonlyArray<TileCellSample>): TerrainMeshStats {
  const mesh = buildTerrainMesh({ samples, wireframe: false, colorMode: true })
  if (!mesh) return { ownerCount: 0, vertexCount: 0, triangleCount: 0, dominantAssetName: null }
  const field = buildSurfaceField(samples)
  const pos = mesh.geometry.getAttribute('position')
  const idx = mesh.geometry.getIndex()
  const stats = {
    ownerCount: field.owners.size,
    vertexCount: pos?.count ?? 0,
    triangleCount: idx ? idx.count / 3 : 0,
    dominantAssetName: pickDominantOwner(field)?.assetName ?? null,
  }
  disposeTerrainMesh(mesh)
  return stats
}
