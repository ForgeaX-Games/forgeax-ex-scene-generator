import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'

export interface StageEnvironment {
  ground: THREE.Mesh
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  dispose(): void
}

/**
 * Studio lights + shadow catcher. No distance fog — a 90–320 m ramp turns a
 * continent overview into a grey wash, which hides the layered-territory board.
 */
export function createStageEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): StageEnvironment {
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x8b97a6, 1)

  scene.fog = null

  const hemi = new THREE.HemisphereLight(0xd7e4f2, 0x4a3b2a, 0.62)
  hemi.name = 'stage-hemi'
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.15)
  sun.name = 'stage-sun'
  sun.position.set(-48 * BASE_CELL_SIZE, -62 * BASE_CELL_SIZE, 86 * BASE_CELL_SIZE)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400 * BASE_CELL_SIZE, 400 * BASE_CELL_SIZE),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  )
  ground.name = 'stage-ground'
  ground.receiveShadow = true
  ground.position.z = -0.04 * BASE_CELL_SIZE
  ground.renderOrder = -1
  scene.add(ground)

  return {
    ground,
    hemi,
    sun,
    dispose() {
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
