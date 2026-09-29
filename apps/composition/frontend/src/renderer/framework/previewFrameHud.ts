import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'

/**
 * BasePlane origin is the top-left. +X is east, +Y is down the page (south).
 * Default flips Y once, so page-north (authoring −Y) is renderer +Y.
 */
export const RENDERER_NORTH = new THREE.Vector3(0, 1, 0)
/** Authoring +X is east; the viewport does not flip X. */
export const RENDERER_EAST = new THREE.Vector3(1, 0, 0)

const NICE_METRES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

export function niceScaleMetres(metresPerPixel: number, desiredPx = 96): { metres: number; pixels: number } {
  const raw = Math.max(1e-6, metresPerPixel) * desiredPx
  let metres = NICE_METRES[0]!
  for (const step of NICE_METRES) {
    if (step <= raw * 1.2) metres = step
  }
  return { metres, pixels: metres / Math.max(1e-6, metresPerPixel) }
}

/** Screen rotation for a needle that points up at 0°. */
export function previewCompassDeg(camera: THREE.Camera): number {
  camera.updateMatrixWorld()
  const forward = new THREE.Vector3()
  camera.getWorldDirection(forward)
  const projected = RENDERER_NORTH.clone().addScaledVector(forward, -RENDERER_NORTH.dot(forward))
  if (projected.lengthSq() < 1e-10) return 0
  projected.normalize()
  const camX = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const camY = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  return Math.atan2(projected.dot(camX), projected.dot(camY)) * (180 / Math.PI)
}

export function previewMetresPerPixel(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  viewport: { width: number; height: number },
): number {
  if (viewport.width < 1 || viewport.height < 1) return 1
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const groundRight = new THREE.Vector3()
  camera.getWorldDirection(groundRight)
  groundRight.cross(camera.up).setZ(0)
  if (groundRight.lengthSq() < 1e-10) groundRight.copy(RENDERER_EAST)
  else groundRight.normalize()

  const a = target.clone()
  const b = target.clone().addScaledVector(groundRight, 100 * BASE_CELL_SIZE)
  a.project(camera)
  b.project(camera)
  const pixels = Math.hypot(
    (b.x - a.x) * 0.5 * viewport.width,
    (b.y - a.y) * 0.5 * viewport.height,
  )
  if (!(pixels > 1e-3)) {
    const dist = camera.position.distanceTo(target)
    const worldH = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist
    return (worldH / viewport.height) / BASE_CELL_SIZE
  }
  return 100 / pixels
}

export function previewFrameReading(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  viewport: { width: number; height: number },
): { compassDeg: number; metres: number; pixels: number } {
  const scale = niceScaleMetres(previewMetresPerPixel(camera, target, viewport))
  return { compassDeg: previewCompassDeg(camera), ...scale }
}

export function formatScaleMetres(metres: number): { n: number; unit: 'm' | 'km' } {
  if (metres >= 1000 && metres % 1000 === 0) return { n: metres / 1000, unit: 'km' }
  return { n: metres, unit: 'm' }
}
