import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'

/** Close enough to inspect a well or eave; OrbitControls' 0.5 m floor blocked that. */
export const MIN_ORBIT_DISTANCE = 0.05 * BASE_CELL_SIZE
/** Enough to back up and see a 2048 m continent frame after the valley is fitted. */
export const MAX_ORBIT_DISTANCE = 16000 * BASE_CELL_SIZE

export interface OrbitTarget {
  target: THREE.Vector3
  minDistance: number
  maxDistance: number
  update?: () => void
}

const _geomBox = new THREE.Box3()
const _aimDir = new THREE.Vector3()
const _lookDir = new THREE.Vector3()
const _planeHit = new THREE.Vector3()
const _viewPlane = new THREE.Plane()

export function isFitExcluded(obj: THREE.Object3D): boolean {
  if (obj.userData?.skipFit) return true
  if (obj.name === 'guide-gizmo' || obj.name === 'world-frame') return true
  return false
}

/** Walk children, but do not enter skipFit / gizmo / world-frame subtrees. */
export function expandContentBounds(root: THREE.Object3D, box: THREE.Box3): void {
  if (isFitExcluded(root)) return
  const geom = (root as THREE.Mesh).geometry
  if (geom) {
    if (!geom.boundingBox) geom.computeBoundingBox()
    if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
      _geomBox.copy(geom.boundingBox).applyMatrix4(root.matrixWorld)
      box.union(_geomBox)
    }
  }
  for (const child of root.children) expandContentBounds(child, box)
}

/**
 * Frame authored content only. Three.js `Box3.setFromObject` still unions
 * invisible meshes, so hiding ContinentFrame is not enough — that 2048 m
 * outline parked the camera kilometres away and made close inspection impossible.
 */
export function autoFitToContent(
  group: THREE.Object3D,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitTarget | null,
): void {
  if (!camera || !controls) return
  group.updateMatrixWorld(true)
  const bbox = new THREE.Box3()
  expandContentBounds(group, bbox)
  if (!isFinite(bbox.min.x) || !isFinite(bbox.max.x) || bbox.isEmpty()) return
  const sphere = new THREE.Sphere()
  bbox.getBoundingSphere(sphere)
  frameBoundingSphere(sphere, camera, controls)
}

function frameBoundingSphere(
  sphere: THREE.Sphere,
  camera: THREE.PerspectiveCamera,
  controls: OrbitTarget,
): void {
  if (!isFinite(sphere.radius) || !isFinite(sphere.center.x)) return
  const radius = Math.max(sphere.radius, BASE_CELL_SIZE)
  const fovRad = camera.fov * Math.PI / 180
  let dist = radius / Math.sin(fovRad / 2)
  const aspect = camera.aspect || 1
  if (aspect < 1) dist /= aspect
  dist *= 1.2
  dist = THREE.MathUtils.clamp(dist, controls.minDistance, controls.maxDistance)

  controls.target.copy(sphere.center)
  const dir = new THREE.Vector3(1, -1, 1).normalize().multiplyScalar(dist)
  camera.position.copy(sphere.center).add(dir)
  camera.up.set(0, 0, 1)
  camera.lookAt(sphere.center)
  syncOrbitClipPlanes(camera, controls.target)
  controls.update?.()
}

/** Fit when planes appear or their identities change — not when a slider resizes one. */
export function shouldFitCameraToWorldPlanes(
  previousIds: readonly string[],
  nextIds: readonly string[],
): boolean {
  if (nextIds.length === 0) return false
  if (previousIds.length !== nextIds.length) return true
  const previous = new Set(previousIds)
  return nextIds.some((id) => !previous.has(id))
}

/** Frame Geometry / BasePlane overlays when the scene has no mesh content yet. */
export function fitCameraToWorldPlanes(
  planes: ReadonlyArray<{ origin: readonly number[]; extent: readonly number[] }>,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitTarget | null,
): void {
  if (!camera || !controls || planes.length === 0) return
  const bbox = new THREE.Box3()
  for (const plane of planes) {
    const x0 = Number(plane.origin[0] ?? 0)
    const y0 = Number(plane.origin[1] ?? 0)
    const w = Number(plane.extent[0] ?? 0)
    const h = Number(plane.extent[1] ?? 0)
    if (![x0, y0, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue
    for (const [x, y] of [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]] as const) {
      bbox.expandByPoint(new THREE.Vector3(x * BASE_CELL_SIZE, -y * BASE_CELL_SIZE, 0))
    }
  }
  if (bbox.isEmpty() || !isFinite(bbox.min.x)) return
  const sphere = new THREE.Sphere()
  bbox.getBoundingSphere(sphere)
  frameBoundingSphere(sphere, camera, controls)
}

/** Frame operating curve / region Geometry when the scene has no mesh content yet. */
export function fitCameraToWorldCurves(
  curves: ReadonlyArray<{ strokes: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number]> }> }>,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitTarget | null,
  arm = 2,
): void {
  if (!camera || !controls || curves.length === 0) return
  const bbox = new THREE.Box3()
  for (const curve of curves) {
    for (const stroke of curve.strokes) {
      for (const point of stroke.points) {
        const x = Number(point[0])
        const y = Number(point[1])
        if (![x, y].every(Number.isFinite)) continue
        for (const [px, py] of [[x - arm, y - arm], [x + arm, y - arm], [x + arm, y + arm], [x - arm, y + arm]] as const) {
          bbox.expandByPoint(new THREE.Vector3(px * BASE_CELL_SIZE, -py * BASE_CELL_SIZE, 0))
        }
      }
    }
  }
  if (bbox.isEmpty() || !isFinite(bbox.min.x)) return
  const sphere = new THREE.Sphere()
  bbox.getBoundingSphere(sphere)
  frameBoundingSphere(sphere, camera, controls)
}

/** Frame point2d X marks when the scene has no mesh content yet. */
export function fitCameraToWorldPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitTarget | null,
  arm = 2,
): void {
  if (!camera || !controls || points.length === 0) return
  const bbox = new THREE.Box3()
  for (const point of points) {
    const x = Number(point.x)
    const y = Number(point.y)
    if (![x, y].every(Number.isFinite)) continue
    for (const [px, py] of [[x - arm, y - arm], [x + arm, y - arm], [x + arm, y + arm], [x - arm, y + arm]] as const) {
      bbox.expandByPoint(new THREE.Vector3(px * BASE_CELL_SIZE, -py * BASE_CELL_SIZE, 0))
    }
  }
  if (bbox.isEmpty() || !isFinite(bbox.min.x)) return
  const sphere = new THREE.Sphere()
  bbox.getBoundingSphere(sphere)
  frameBoundingSphere(sphere, camera, controls)
}

export function isZoomExcluded(obj: THREE.Object3D): boolean {
  if (isFitExcluded(obj)) return true
  if (obj.userData?.gizmoHandle) return true
  if (obj.name.startsWith('guide-pin:') || obj.name.startsWith('guide-dot:')) return true
  return false
}

export function collectZoomPickables(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  const walk = (obj: THREE.Object3D): void => {
    if (isZoomExcluded(obj)) return
    if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).geometry) out.push(obj)
    for (const child of obj.children) walk(child)
  }
  walk(root)
  return out
}

/** BasePlane surfaces live under the skipFit world-frame; the metre grid does not. */
export function collectWorldPlaneZoomPickables(root: THREE.Object3D | null | undefined): THREE.Object3D[] {
  if (!root) return []
  const out: THREE.Object3D[] = []
  root.traverse((obj) => {
    if (!obj.userData?.isPlane) return
    if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).geometry) out.push(obj)
  })
  return out
}

export function collectCursorZoomPickables(
  content: THREE.Object3D,
  worldFrame?: THREE.Object3D | null,
): THREE.Object3D[] {
  return [...collectZoomPickables(content), ...collectWorldPlaneZoomPickables(worldFrame)]
}

/**
 * Mesh under the cursor, else the view plane through the current orbit target.
 * Do not fall back to Z=0 — a grazing ray hits the continent kilometres away
 * and the next wheel tick slams the camera off the thing you were pointing at.
 */
export function pickZoomAim(
  raycaster: THREE.Raycaster,
  pickables: readonly THREE.Object3D[],
  camera: THREE.Camera,
  fallbackTarget: THREE.Vector3,
): THREE.Vector3 {
  const hit = raycaster.intersectObjects(pickables as THREE.Object3D[], false)[0]
  if (hit) return hit.point.clone()
  camera.getWorldDirection(_lookDir)
  _viewPlane.setFromNormalAndCoplanarPoint(_lookDir, fallbackTarget)
  if (raycaster.ray.intersectPlane(_viewPlane, _planeHit)) return _planeHit.clone()
  return fallbackTarget.clone()
}

/** One notch ≈ 100 px (Windows wheel) or 1 line. Trackpad pixels scale down. */
export function wheelZoomTicks(event: { deltaY: number; deltaMode?: number }): number {
  const mag = Math.abs(event.deltaY)
  if (mag === 0) return 0
  const mode = event.deltaMode ?? 0
  if (mode === 1) return Math.min(4, mag)
  if (mode === 2) return 3
  return THREE.MathUtils.clamp(mag / 100, 0.12, 3)
}

/**
 * Dolly along the camera→aim ray and keep the camera orientation.
 * The aim stays on the same pixel; the orbit target is parked on the look
 * axis so a later `OrbitControls.update()` `lookAt` cannot yank it to center.
 */
export function applyCursorZoom(
  camera: THREE.PerspectiveCamera,
  orbit: OrbitTarget,
  aim: THREE.Vector3,
  event: { deltaY: number; deltaMode?: number },
): void {
  _aimDir.copy(aim).sub(camera.position)
  const dist = _aimDir.length()
  if (dist < 1e-6) return
  _aimDir.multiplyScalar(1 / dist)
  const ticks = wheelZoomTicks(event)
  if (ticks === 0) return
  const inward = event.deltaY < 0
  const scale = Math.pow(0.78, ticks)
  let next = inward ? dist * scale : dist / scale
  next = THREE.MathUtils.clamp(next, orbit.minDistance, orbit.maxDistance)
  camera.position.copy(aim).addScaledVector(_aimDir, -next)
  camera.getWorldDirection(_lookDir)
  orbit.target.copy(camera.position).addScaledVector(_lookDir, next)
}

export function syncOrbitClipPlanes(camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
  const dist = Math.max(camera.position.distanceTo(target), MIN_ORBIT_DISTANCE)
  camera.near = THREE.MathUtils.clamp(dist * 0.02, 0.02 * BASE_CELL_SIZE, 4 * BASE_CELL_SIZE)
  camera.far = Math.max(4000 * BASE_CELL_SIZE, dist * 12)
  camera.updateProjectionMatrix()
}
