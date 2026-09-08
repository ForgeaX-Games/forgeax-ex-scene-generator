import * as THREE from 'three'

/** Reject a Z-up ground-plane hit when the camera ray is this close to edge-on. */
export const GUIDE_DRAG_GROUND_MIN_Z = 0.18

const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _back = new THREE.Vector3()
const _look = new THREE.Vector3()
const _ground = new THREE.Vector3()
const _plane = new THREE.Plane()
const _groundNormal = new THREE.Vector3(0, 0, 1)

export function cellToWorldXY(cellX: number, cellY: number, cellSize: number): { x: number; y: number } {
  return { x: cellX * cellSize, y: -cellY * cellSize }
}

export function worldXYToCell(worldX: number, worldY: number, cellSize: number): { x: number; y: number } {
  return {
    x: Math.round(worldX / cellSize),
    y: Math.round(-worldY / cellSize),
  }
}

/** Snap a world XY to the cell that SetParam will write, then back to that cell's world origin. */
export function snapWorldXYToCellWorld(
  worldX: number,
  worldY: number,
  cellSize: number,
): { cell: { x: number; y: number }; world: { x: number; y: number } } {
  const cell = worldXYToCell(worldX, worldY, cellSize)
  return { cell, world: cellToWorldXY(cell.x, cell.y, cellSize) }
}

export function guideDragGrabOffset(
  hit: { x: number; y: number },
  cellX: number,
  cellY: number,
  cellSize: number,
): { x: number; y: number } {
  const origin = cellToWorldXY(cellX, cellY, cellSize)
  return { x: hit.x - origin.x, y: hit.y - origin.y }
}

/**
 * Map a screen-pixel drag onto the XY (cell) plane.
 * Z-up camera: mouse right follows camera-right flattened to XY; mouse up follows
 * look-direction flattened to XY (or camera-up when the view is top-down).
 */
export function screenDeltaToWorldXY(
  startWorld: { x: number; y: number; z: number },
  camera: THREE.PerspectiveCamera,
  pixelDx: number,
  pixelDy: number,
  viewportHeight: number,
): { x: number; y: number } {
  const dist = Math.hypot(
    camera.position.x - startWorld.x,
    camera.position.y - startWorld.y,
    camera.position.z - startWorld.z,
  )
  const worldPerPixel = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeight)
  camera.matrixWorld.extractBasis(_right, _up, _back)
  _right.z = 0
  if (_right.lengthSq() < 1e-8) _right.set(0, 1, 0)
  else _right.normalize()

  _look.copy(_back).negate()
  _look.z = 0
  if (_look.lengthSq() < 1e-4) {
    _ground.copy(_up)
    _ground.z = 0
    if (_ground.lengthSq() < 1e-8) _ground.set(0, 1, 0)
    else _ground.normalize()
  } else {
    _ground.copy(_look).normalize()
  }
  _ground.addScaledVector(_right, -_ground.dot(_right))
  if (_ground.lengthSq() < 1e-8) _ground.set(-_right.y, _right.x, 0)
  _ground.normalize()

  const sx = pixelDx * worldPerPixel
  const sy = -pixelDy * worldPerPixel
  return {
    x: startWorld.x + _right.x * sx + _ground.x * sy,
    y: startWorld.y + _right.y * sx + _ground.y * sy,
  }
}

/**
 * Period-1 Control drag stays on the XY cell plane (Z is display-only).
 * Prefer a Z-up ground hit with grab offset so the pin does not jump when the
 * ray first hits the raised head. Fall back to screen-space when the camera
 * is edge-on to the ground — that intersection otherwise flies off the map.
 */
export function resolveGuideDragWorld(
  ray: THREE.Ray,
  origin: { x: number; y: number; z: number },
  grabOffset: { x: number; y: number },
  camera: THREE.PerspectiveCamera,
  pixelDx: number,
  pixelDy: number,
  viewportHeight: number,
  out: THREE.Vector3,
): { x: number; y: number } {
  if (Math.abs(ray.direction.z) >= GUIDE_DRAG_GROUND_MIN_Z) {
    _plane.set(_groundNormal, -origin.z)
    if (ray.intersectPlane(_plane, out)) {
      return { x: out.x - grabOffset.x, y: out.y - grabOffset.y }
    }
  }
  return screenDeltaToWorldXY(origin, camera, pixelDx, pixelDy, viewportHeight)
}
