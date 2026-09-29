import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'

export interface CreateViewGuides3dOptions {
  /** Total XY span in world units. */
  size?: number
  /** Number of cell intervals across the grid. */
  divisions?: number
  /** XYZ axis length in world units. */
  axisLength?: number
}

/**
 * Modeling-style guides for the renderer's Z-up coordinate system.
 *
 * GridHelper is XZ/Y-up by default, so it is rotated onto XY. The group is
 * intentionally mounted beside content roots so it never expands auto-fit
 * bounds. A small positive Z bias keeps the z=0 grid legible over flat content.
 */
export function createViewGuides3d(opts: CreateViewGuides3dOptions = {}): THREE.Group {
  const size = opts.size ?? BASE_CELL_SIZE * 200
  const divisions = opts.divisions ?? 200
  const axisLength = opts.axisLength ?? BASE_CELL_SIZE * 12

  const group = new THREE.Group()
  group.name = 'view-guides-3d'

  const grid = new THREE.GridHelper(size, divisions, 0x6688aa, 0x66707e)
  grid.name = 'xy-grid'
  grid.rotation.x = Math.PI / 2
  grid.position.z = BASE_CELL_SIZE * 0.01
  grid.renderOrder = 900
  for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
    material.transparent = true
    material.opacity = 0.32
    material.depthWrite = false
    material.fog = false
  }
  group.add(grid)

  const axes = new THREE.AxesHelper(axisLength)
  axes.name = 'xyz-axes'
  axes.renderOrder = 901
  for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) {
    material.transparent = true
    material.opacity = 0.9
    material.depthTest = false
    material.depthWrite = false
    material.fog = false
  }
  group.add(axes)
  return group
}

export function disposeViewGuides3d(group: THREE.Group): void {
  group.traverse((object) => {
    const renderable = object as THREE.LineSegments
    renderable.geometry?.dispose()
    const material = renderable.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material?.dispose()
  })
  group.clear()
}
