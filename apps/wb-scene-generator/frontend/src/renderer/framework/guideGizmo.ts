import * as THREE from 'three'

export type GizmoAxis = 'x' | 'y' | 'z'
export type GizmoPlane = 'xy' | 'xz' | 'yz'
export type GizmoHandle = GizmoAxis | GizmoPlane

export interface GizmoDragState {
  handle: GizmoHandle
  start: THREE.Vector3
  grab: THREE.Vector3
  /** Closest-point parameter on the locked axis at pointer-down. */
  axisT0?: number
}

const AXIS_DIR: Record<GizmoAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
}

const PLANE_NORMAL: Record<GizmoPlane, THREE.Vector3> = {
  xy: new THREE.Vector3(0, 0, 1),
  xz: new THREE.Vector3(0, 1, 0),
  yz: new THREE.Vector3(1, 0, 0),
}

export const AXIS_COLOR: Record<GizmoAxis, number> = {
  x: 0xe74c3c,
  y: 0x27ae60,
  z: 0x2980b9,
}

const HOVER_COLOR = 0xffee55
const EDGE_ON = 0.12

const _r = new THREE.Vector3()
const _hit = new THREE.Vector3()
const _plane = new THREE.Plane()
const _up = new THREE.Vector3(0, 1, 0)
const _gizmoPos = new THREE.Vector3()

export function isGizmoAxis(handle: GizmoHandle): handle is GizmoAxis {
  return handle === 'x' || handle === 'y' || handle === 'z'
}

/** Z / XZ / YZ change height while dragging. X / Y / XY stay on the terrain. */
export function gizmoHandleLiftsPin(handle: GizmoHandle): boolean {
  return handle === 'z' || handle === 'xz' || handle === 'yz'
}

export function parseGizmoHandle(raw: unknown): GizmoHandle | undefined {
  if (raw === 'x' || raw === 'y' || raw === 'z' || raw === 'xy' || raw === 'xz' || raw === 'yz') return raw
  return undefined
}

export function colorForHandle(handle: GizmoHandle): number {
  if (handle === 'x' || handle === 'yz') return AXIS_COLOR.x
  if (handle === 'y' || handle === 'xz') return AXIS_COLOR.y
  return AXIS_COLOR.z
}

/** Closest-point parameter `s` on `origin + s * axis` to the camera ray. */
export function rayAxisParameter(ray: THREE.Ray, origin: THREE.Vector3, axis: THREE.Vector3): number | null {
  _r.subVectors(ray.origin, origin)
  const a = ray.direction.dot(ray.direction)
  const b = ray.direction.dot(axis)
  const c = axis.dot(axis)
  const d = ray.direction.dot(_r)
  const e = axis.dot(_r)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-10) return null
  return (a * e - b * d) / denom
}

function isGizmoPlane(handle: GizmoHandle): handle is GizmoPlane {
  return handle === 'xy' || handle === 'xz' || handle === 'yz'
}

/**
 * Textbook move gizmo (Unity/Blender):
 * - axis: closest point between the camera ray and that world axis
 * - plane: intersect the camera ray with the plane through the point
 * Grab offset keeps the point still on pointer-down.
 */
export function beginGizmoDrag(
  handle: GizmoHandle,
  ray: THREE.Ray,
  start: THREE.Vector3,
): GizmoDragState | null {
  if (isGizmoAxis(handle)) {
    const axis = AXIS_DIR[handle]
    const t0 = rayAxisParameter(ray, start, axis)
    if (t0 === null) return null
    return {
      handle,
      start: start.clone(),
      grab: start.clone().addScaledVector(axis, t0),
      axisT0: t0,
    }
  }
  const normal = PLANE_NORMAL[handle]
  if (Math.abs(ray.direction.dot(normal)) < EDGE_ON) return null
  _plane.setFromNormalAndCoplanarPoint(normal, start)
  if (!ray.intersectPlane(_plane, _hit)) return null
  return { handle, start: start.clone(), grab: _hit.clone() }
}

export function applyGizmoDrag(state: GizmoDragState, ray: THREE.Ray, out: THREE.Vector3): boolean {
  if (isGizmoAxis(state.handle)) {
    const axis = AXIS_DIR[state.handle]
    const t = rayAxisParameter(ray, state.start, axis)
    if (t === null) return false
    out.copy(state.start).addScaledVector(axis, t - (state.axisT0 ?? 0))
    return true
  }
  if (!isGizmoPlane(state.handle)) return false
  const normal = PLANE_NORMAL[state.handle]
  if (Math.abs(ray.direction.dot(normal)) < EDGE_ON) return false
  _plane.setFromNormalAndCoplanarPoint(normal, state.start)
  if (!ray.intersectPlane(_plane, _hit)) return false
  out.copy(state.start).add(_hit).sub(state.grab)
  return true
}

function gizmoMaterial(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
}

function tagHandle(obj: THREE.Object3D, handle: GizmoHandle, color: number, opacity: number): void {
  obj.userData.gizmoHandle = handle
  obj.userData.gizmoBaseColor = color
  obj.userData.gizmoBaseOpacity = opacity
}

function addAxis(parent: THREE.Group, handle: GizmoAxis): void {
  const dir = AXIS_DIR[handle]
  const color = AXIS_COLOR[handle]
  const mat = gizmoMaterial(color)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.62, 8), mat)
  shaft.quaternion.setFromUnitVectors(_up, dir)
  shaft.position.copy(dir).multiplyScalar(0.43)
  shaft.renderOrder = 41
  tagHandle(shaft, handle, color, 1)

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 12), mat)
  head.quaternion.setFromUnitVectors(_up, dir)
  head.position.copy(dir).multiplyScalar(0.86)
  head.renderOrder = 42
  tagHandle(head, handle, color, 1)

  const hitMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false })
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.78, 8), hitMat)
  hit.name = `gizmo-hit:${handle}`
  hit.quaternion.copy(shaft.quaternion)
  // Keep the fat pick volume off the origin so it does not steal plane clicks.
  hit.position.copy(dir).multiplyScalar(0.55)
  hit.renderOrder = 43
  tagHandle(hit, handle, color, 1)
  parent.add(shaft, head, hit)
}

function addPlane(parent: THREE.Group, handle: GizmoPlane): void {
  const color = colorForHandle(handle)
  const size = handle === 'xy' ? 0.28 : 0.22
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), gizmoMaterial(color, handle === 'xy' ? 0.5 : 0.38))
  if (handle === 'xz') mesh.rotation.x = Math.PI / 2
  if (handle === 'yz') mesh.rotation.y = -Math.PI / 2
  if (handle === 'xy') mesh.position.set(0.28, 0.28, 0)
  if (handle === 'xz') mesh.position.set(0.22, 0, 0.22)
  if (handle === 'yz') mesh.position.set(0, 0.22, 0.22)
  mesh.name = `gizmo-hit:${handle}`
  mesh.renderOrder = 40
  tagHandle(mesh, handle, color, handle === 'xy' ? 0.5 : 0.38)
  parent.add(mesh)
}

/** World-aligned move gizmo (Z-up): RGB axes + three plane squares. */
export function buildMoveGizmo(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'guide-gizmo'
  group.userData = { skipFit: true, schema: 'guide' }
  group.renderOrder = 40
  addAxis(group, 'x')
  addAxis(group, 'y')
  addAxis(group, 'z')
  addPlane(group, 'xy')
  addPlane(group, 'xz')
  addPlane(group, 'yz')
  group.traverse((child) => { child.userData.skipFit = true })
  return group
}

export function disposeMoveGizmo(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
  })
}

export function scaleMoveGizmo(root: THREE.Object3D, camera: THREE.Camera): void {
  const gizmo = root.getObjectByName('guide-gizmo')
  if (!gizmo) return
  gizmo.getWorldPosition(_gizmoPos)
  const dist = camera.position.distanceTo(_gizmoPos)
  gizmo.scale.setScalar(THREE.MathUtils.clamp(dist * 0.08, 4.5, 12))
}

export function collectGizmoPickables(root: THREE.Object3D): THREE.Object3D[] {
  const hits: THREE.Object3D[] = []
  root.traverse((obj) => {
    if (parseGizmoHandle(obj.userData.gizmoHandle)) hits.push(obj)
  })
  return hits
}

export function collectGizmoHits(root: THREE.Object3D): THREE.Object3D[] {
  return collectGizmoPickables(root).filter((obj) => obj.name.startsWith('gizmo-hit:'))
}

export function hoveredGizmoHandle(root: THREE.Object3D): GizmoHandle | undefined {
  const gizmo = root.getObjectByName('guide-gizmo')
  return parseGizmoHandle(gizmo?.userData.hoverHandle)
}

export function pickGizmoHandle(raycaster: THREE.Raycaster, root: THREE.Object3D): GizmoHandle | undefined {
  const gizmo = root.getObjectByName('guide-gizmo')
  if (!gizmo) return undefined
  gizmo.getWorldPosition(_gizmoPos)
  const scale = Math.max(gizmo.scale.x, 1e-6)
  const axisReach = 1.1 * scale
  const axisNear = 0.12 * scale
  let bestAxis: GizmoAxis | undefined
  let bestDist = 0.16 * scale
  for (const axis of ['x', 'y', 'z'] as const) {
    const dir = AXIS_DIR[axis]
    const t = rayAxisParameter(raycaster.ray, _gizmoPos, dir)
    if (t === null || t < axisNear || t > axisReach) continue
    _hit.copy(_gizmoPos).addScaledVector(dir, t)
    const dist = raycaster.ray.distanceToPoint(_hit)
    if (dist < bestDist) {
      bestDist = dist
      bestAxis = axis
    }
  }
  if (bestAxis) return bestAxis
  const planes = collectGizmoHits(gizmo).filter((obj) => {
    const handle = parseGizmoHandle(obj.userData.gizmoHandle)
    return !!handle && handle.length === 2
  })
  const hit = raycaster.intersectObjects(planes, false)[0]
  return parseGizmoHandle(hit?.object.userData.gizmoHandle)
}

export function setGizmoHover(root: THREE.Object3D, handle: GizmoHandle | null): boolean {
  const gizmo = root.getObjectByName('guide-gizmo')
  if (!gizmo) return false
  if (gizmo.userData.hoverHandle === handle) return false
  gizmo.userData.hoverHandle = handle
  gizmo.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const tagged = parseGizmoHandle(obj.userData.gizmoHandle)
    if (!tagged) return
    const mat = obj.material
    if (!(mat instanceof THREE.MeshBasicMaterial) || mat.visible === false) return
    const active = handle !== null && tagged === handle
    mat.color.setHex(active ? HOVER_COLOR : (obj.userData.gizmoBaseColor as number))
    mat.opacity = active ? Math.max(0.85, obj.userData.gizmoBaseOpacity as number) : (obj.userData.gizmoBaseOpacity as number)
  })
  return true
}
