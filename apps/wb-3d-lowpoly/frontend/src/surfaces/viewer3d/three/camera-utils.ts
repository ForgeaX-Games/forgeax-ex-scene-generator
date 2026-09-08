// 💡 相机适配工具：根据模型 bbox 计算合适的相机距离和裁剪面
import * as THREE from 'three'

export interface FitResult {
  position: THREE.Vector3
  target: THREE.Vector3
  near: number
  far: number
}

const MIN_NEAR = 0.001
const MIN_FAR_GAP = 1
const DEFAULT_CLIP_FAR = 1000

function getBoundingBox(object: THREE.Object3D | readonly THREE.Object3D[]): THREE.Box3 | null {
  const objects = Array.isArray(object) ? object : [object]
  const box = new THREE.Box3()
  for (const entry of objects) {
    if (!entry.visible) continue
    box.expandByObject(entry)
  }
  return box.isEmpty() ? null : box
}

function computeClipPlanesForSphere(camera: THREE.PerspectiveCamera, sphere: THREE.Sphere): { near: number; far: number } {
  camera.updateMatrixWorld(true)
  const centerDepth = -sphere.center.clone().applyMatrix4(camera.matrixWorldInverse).z
  const nearPadding = Math.max(sphere.radius * 0.1, 0.02)
  const farPadding = Math.max(sphere.radius * 0.5, 0.5)
  const near = Math.max(MIN_NEAR, centerDepth - sphere.radius - nearPadding)
  const far = Math.max(near + MIN_FAR_GAP, centerDepth + sphere.radius + farPadding)
  return { near, far }
}

function computeClipPlanesForBox(camera: THREE.PerspectiveCamera, box: THREE.Box3): { near: number; far: number } {
  return computeClipPlanesForSphere(camera, box.getBoundingSphere(new THREE.Sphere()))
}

/**
 * Cache the world-space bounding sphere of the scene (model + helpers). Geometry is
 * static, so this is computed once per model load and reused for cheap per-frame
 * near/far updates during orbit/zoom.
 */
export function computeSceneSphere(object: THREE.Object3D | readonly THREE.Object3D[]): THREE.Sphere | null {
  const box = getBoundingBox(object)
  return box ? box.getBoundingSphere(new THREE.Sphere()) : null
}

/**
 * Recompute near/far from the camera's current distance to a cached sphere. Cheap
 * enough to run on every OrbitControls `change` so the near plane tracks the camera
 * continuously — otherwise zooming in from a far view leaves a stale (large) near
 * plane that clips the whole model (black edges / black screen until the gesture ends).
 */
export function applyClippingForSphere(camera: THREE.PerspectiveCamera, sphere: THREE.Sphere): void {
  const { near, far } = computeClipPlanesForSphere(camera, sphere)
  if (near === camera.near && far === camera.far) return
  camera.near = near
  camera.far = far
  camera.updateProjectionMatrix()
}

export function computeFit(camera: THREE.PerspectiveCamera, object: THREE.Object3D): FitResult {
  const box = getBoundingBox(object)
  if (!box) {
    return {
      position: camera.position.clone(),
      target: new THREE.Vector3(),
      near: camera.near,
      far: camera.far || DEFAULT_CLIP_FAR,
    }
  }

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = camera.fov * (Math.PI / 180)
  const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.5

  const direction = new THREE.Vector3()
  if (camera.position.lengthSq() > 0) {
    direction.copy(camera.position).sub(center).normalize()
  }
  if (direction.lengthSq() < 0.001) direction.set(1, 0.8, 1).normalize()

  const position = center.clone().add(direction.multiplyScalar(distance))
  const fitCamera = camera.clone()
  fitCamera.position.copy(position)
  fitCamera.lookAt(center)
  const { near, far } = computeClipPlanesForBox(fitCamera, box)

  return { position, target: center, near, far }
}

export function updateCameraClipping(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D | readonly THREE.Object3D[],
): void {
  const box = getBoundingBox(object)
  if (!box) return
  const { near, far } = computeClipPlanesForBox(camera, box)
  camera.near = near
  camera.far = far
  camera.updateProjectionMatrix()
}
