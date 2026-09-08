// Voxel adapter: RendererVoxelLayer → InstancedMesh of unit cubes.
// Shared by Default and free3d. Do not import this from a mode into another mode.

import * as THREE from 'three'
import type { RendererVoxelLayer } from '../../types'
import { BASE_CELL_SIZE } from '../geometry/constants'
import { gridCellCenterToWorld } from '../geometry/worldCoordinates'
import { colorForValue } from '../palette'

export interface VoxelBuildOptions {
  layer: RendererVoxelLayer
  /** Envelope bbox info (shared world coords, axis centered on the grid). */
  maxRows: number
  maxCols: number
  /** Vertical scale factor. */
  heightScale: number
  isSelected: boolean
  colorMode: boolean
  wireframe: boolean
}

/**
 * Compile one voxel layer into a single InstancedMesh (one instance per cell).
 *
 * World coordinates (metres):
 *   X = cell.x + 0.5
 *   Y = -(cell.y + 0.5)
 *   Z = (cell.z + 0.5) * BASE_CELL_SIZE * heightScale
 *
 * Each cube edge = BASE_CELL_SIZE. Returns null when there are no cells.
 */
export function buildVoxelMesh(opts: VoxelBuildOptions): THREE.InstancedMesh | null {
  const { layer, heightScale, isSelected, wireframe } = opts
  const cells = layer.cells
  if (!cells || cells.length === 0) return null

  const geom = new THREE.BoxGeometry(1, 1, 1)
  const mat = new THREE.MeshLambertMaterial({
    flatShading: true,
    transparent: wireframe,
    opacity: wireframe ? 0.25 : 1,
    wireframe,
  })

  const mesh = new THREE.InstancedMesh(geom, mat, cells.length)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const cell = BASE_CELL_SIZE

  const rgba = colorForValue(layer.value, { selected: isSelected })
  color.setRGB(rgba.r / 255, rgba.g / 255, rgba.b / 255)

  const heightWorld = cell * heightScale

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const world = gridCellCenterToWorld(c.x, c.y)
    const wx = world.x * cell
    const wy = world.y * cell
    const wz = (c.z + 0.5) * heightWorld

    dummy.position.set(wx, wy, wz)
    dummy.scale.set(cell, cell, heightWorld)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, color)
  }

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  return mesh
}

/** Dispose an InstancedMesh's geometry + material(s). */
export function disposeMesh(mesh: THREE.InstancedMesh): void {
  mesh.geometry.dispose()
  const mat = mesh.material
  if (Array.isArray(mat)) mat.forEach(m => m.dispose())
  else mat.dispose()
}
