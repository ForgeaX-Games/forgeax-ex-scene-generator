import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'

export interface StageEnvironment {
  ground: THREE.Mesh
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  invalidateBounds(content: THREE.Object3D): void
  update(): void
  dispose(): void
}

export interface StageEnvironmentOptions {
  shadowMapSize?: 1024 | 2048 | 4096
  /** Intensity of the generated environment; existing scene environments are preserved. */
  environmentIntensity?: number
}

function createDaylightEnvironment(): THREE.DataTexture {
  const width = 64, height = 32
  const pixels = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const elevation = Math.cos(Math.PI * (y + 0.5) / height)
    const horizon = Math.exp(-Math.abs(elevation) * 5)
    const color = elevation >= 0
      ? [0.50 + horizon * 0.45, 0.66 + horizon * 0.29, 0.88 + horizon * 0.12]
      : [0.22 + horizon * 0.5, 0.20 + horizon * 0.5, 0.16 + horizon * 0.5]
    for (let x = 0; x < width; x++) pixels.set([...color, 1], (y * width + x) * 4)
  }
  const daylight = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType)
  daylight.mapping = THREE.EquirectangularReflectionMapping
  daylight.needsUpdate = true
  return daylight
}

/**
 * Studio lights + shadow catcher. No distance fog — a 90–320 m ramp turns a
 * continent overview into a grey wash, which hides the authored board.
 */
export function createStageEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  options: StageEnvironmentOptions = {},
): StageEnvironment {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.setClearColor(0x8b97a6, 1)

  scene.fog = null

  // Supply reflections only when the host has not authored an environment.
  const previousIntensity = scene.environmentIntensity
  const previousRotation = scene.environmentRotation.clone()
  const daylight = scene.environment === null ? createDaylightEnvironment() : null
  if (daylight) {
    scene.environment = daylight
    scene.environmentRotation.set(Math.PI / 2, 0, 0)
    scene.environmentIntensity = options.environmentIntensity ?? 0.65
  }

  const hemi = new THREE.HemisphereLight(0xd7e4f2, 0x4a3b2a, 0.62)
  hemi.name = 'stage-hemi'
  hemi.position.set(0, 0, 1)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.15)
  sun.name = 'stage-sun'
  sun.position.set(-48 * BASE_CELL_SIZE, -62 * BASE_CELL_SIZE, 86 * BASE_CELL_SIZE)
  sun.castShadow = true
  const shadowMapSize = options.shadowMapSize ?? 2048
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
  sun.shadow.camera.near = 1 * BASE_CELL_SIZE
  sun.shadow.camera.far = 260 * BASE_CELL_SIZE
  const extent = 70 * BASE_CELL_SIZE
  sun.shadow.camera.left = -extent
  sun.shadow.camera.right = extent
  sun.shadow.camera.top = extent
  sun.shadow.camera.bottom = -extent
  sun.shadow.bias = -0.00025
  scene.add(sun)
  scene.add(sun.target)

  const groundSize = 400 * BASE_CELL_SIZE
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  )
  ground.name = 'stage-ground'
  ground.receiveShadow = true
  ground.position.z = -0.04 * BASE_CELL_SIZE
  ground.renderOrder = -1
  scene.add(ground)

  let pendingContent: THREE.Object3D | null = null

  return {
    ground,
    hemi,
    sun,
    invalidateBounds(content) {
      pendingContent = content
    },
    update() {
      if (!pendingContent) return
      const bounds = new THREE.Box3().setFromObject(pendingContent)
      pendingContent = null
      ground.visible = !bounds.isEmpty()
      if (bounds.isEmpty()) return
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const distance = Math.max(12 * BASE_CELL_SIZE, size.length() * 1.5)
      sun.target.position.copy(center)
      sun.position.copy(center).add(new THREE.Vector3(-0.48, -0.62, 0.86).normalize().multiplyScalar(distance))
      sun.target.updateMatrixWorld()
      sun.updateMatrixWorld()
      const camera = sun.shadow.camera
      camera.position.copy(sun.position)
      camera.lookAt(center)
      camera.updateMatrixWorld()
      const lightBounds = new THREE.Box3()
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        lightBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse))
      }
      const margin = Math.max(BASE_CELL_SIZE, size.length() * 0.015)
      camera.left = lightBounds.min.x - margin
      camera.right = lightBounds.max.x + margin
      camera.bottom = lightBounds.min.y - margin
      camera.top = lightBounds.max.y + margin
      camera.near = Math.max(0.1 * BASE_CELL_SIZE, -lightBounds.max.z - margin)
      camera.far = -lightBounds.min.z + margin
      camera.updateProjectionMatrix()
      sun.shadow.normalBias = 0.025 * BASE_CELL_SIZE
      sun.shadow.needsUpdate = true
      ground.position.set(center.x, center.y, bounds.min.z - 0.04 * BASE_CELL_SIZE)
      ground.scale.set(Math.max(1, size.x / groundSize + 0.1), Math.max(1, size.y / groundSize + 0.1), 1)
    },
    dispose() {
      pendingContent = null
      if (daylight && scene.environment === daylight) {
        scene.environment = null
        scene.environmentIntensity = previousIntensity
        scene.environmentRotation.copy(previousRotation)
      }
      daylight?.dispose()
      scene.remove(hemi, sun, sun.target, ground)
      ground.geometry.dispose()
      const mat = ground.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
      sun.shadow.map?.dispose()
      scene.fog = null
    },
  }
}

export function countStageStats(root: THREE.Object3D): { triangles: number; objects: number } {
  let triangles = 0
  let objects = 0
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.Line) && !(obj instanceof THREE.InstancedMesh)) return
    if (obj.name === 'stage-ground') return
    objects += 1
    const geom = obj.geometry
    const index = geom.getIndex()
    const pos = geom.getAttribute('position')
    if (index) triangles += Math.floor(index.count / 3)
    else if (pos) triangles += Math.floor(pos.count / 3)
    if (obj instanceof THREE.InstancedMesh) triangles *= Math.max(1, obj.count)
  })
  return { triangles, objects }
}
