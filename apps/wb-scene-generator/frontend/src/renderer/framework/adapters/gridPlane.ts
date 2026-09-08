// Grid adapter: dense GridLayer → one heatmap quad on the XY plane.
// Intermediate previews (no scene_output) must still be visible: every finite
// cell is painted, including 0. This is Top's color heatmap in 3D, not 3DMesh's
// heightfield.

import * as THREE from 'three'
import type { GridLayer } from '../../types'
import { BASE_CELL_SIZE } from '../geometry/constants'
import { gridCornerToWorld } from '../geometry/worldCoordinates'
import { colorForValue } from '../palette'

/** Sit just above z=0 so the plane is a floor, not fighting voxel bottoms. */
export const GRID_PLANE_Z = 0.02

export interface GridPlaneBuildOptions {
  layer: GridLayer
  wireframe?: boolean
  /** Extra lift so stacked grid layers do not z-fight. */
  layerIdx?: number
}

/**
 * One Mesh covering the full rows×cols rectangle. Zeros are painted (dimmer),
 * not skipped — a noise/mask/heightfield with many zeros must not vanish.
 * Returns null only when the grid has no extent.
 */
export function buildGridPlaneMesh(opts: GridPlaneBuildOptions): THREE.Mesh | null {
  const { layer, wireframe = false, layerIdx = 0 } = opts
  const rows = layer.rows
  const cols = layer.cols
  if (rows <= 0 || cols <= 0) return null

  const pixels = new Uint8Array(cols * rows * 4)
  for (let row = 0; row < rows; row++) {
    const line = layer.data[row]
    for (let col = 0; col < cols; col++) {
      const value = line?.[col]
      const finite = typeof value === 'number' && Number.isFinite(value)
      const rgba = finite
        ? colorForValue(value, { alpha: value === 0 ? 0.45 : 0.92 })
        : { r: 0, g: 0, b: 0, a: 0 }
      const i = (row * cols + col) * 4
      pixels[i] = rgba.r
      pixels[i + 1] = rgba.g
      pixels[i + 2] = rgba.b
      pixels[i + 3] = rgba.a
    }
  }

  const texture = new THREE.DataTexture(pixels, cols, rows, THREE.RGBAFormat)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.flipY = true
  texture.needsUpdate = true
  texture.colorSpace = THREE.SRGBColorSpace

  const cell = BASE_CELL_SIZE
  const geom = new THREE.PlaneGeometry(cols * cell, rows * cell)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    wireframe,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = `grid-plane:${layer.key}`
  mesh.frustumCulled = false
  mesh.userData.gridTexture = texture

  const origin = gridCornerToWorld(0, 0)
  const far = gridCornerToWorld(cols, rows)
  mesh.position.set(
    ((origin.x + far.x) / 2) * cell,
    ((origin.y + far.y) / 2) * cell,
    (GRID_PLANE_Z + layerIdx * 0.01) * cell,
  )
  mesh.updateMatrix()
  geom.computeBoundingBox()
  return mesh
}

export function disposeGridPlaneMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose()
  const texture = mesh.userData.gridTexture as THREE.Texture | undefined
  texture?.dispose()
  const mat = mesh.material
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
  else mat.dispose()
}
