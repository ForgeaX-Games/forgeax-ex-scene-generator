// Mode-local GLB loader + normalized template (Y-up glTF → Z-up scene).
// Pivot: root at identity; geometric bottom-center at local (0,0,0) so
// instance.position = ground puts feet on the surface (not the mesh centroid).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import type { ObjectModelDetail } from './modelsApi'
import { objectModelFileUrl } from './modelsApi'

const loader = new GLTFLoader()
const templateCache = new Map<string, Promise<LoadedObjectTemplate | null>>()

export interface LoadedObjectTemplate {
  name: string
  /** Normalized root: identity transform; feet at local z=0, XY centered. */
  root: THREE.Object3D
  targetHeightCells: number
}

/**
 * Orient Y-up → Z-up, scale to target height, bake offsets into the child so the
 * returned root stays at (0,0,0)/(1,1,1). Safe to `position.set(x,y,groundZ)`.
 */
export function normalizeTemplate(src: THREE.Object3D, targetHeightCells: number): THREE.Object3D {
  const root = new THREE.Group()
  root.name = 'object-model-template'
  const model = src.clone(true)
  // glTF is Y-up; 3DMesh scene is Z-up. Scale on the child (not root) so we can
  // bake foot offsets without fighting root.scale / root.position.
  model.rotation.x = Math.PI / 2
  root.add(model)
  root.updateMatrixWorld(true)

  const box0 = new THREE.Box3().setFromObject(root)
  const size0 = box0.getSize(new THREE.Vector3())
  const targetH = Math.max(targetHeightCells, 0.5) * BASE_CELL_SIZE
  const height0 = size0.z > 1e-4 ? size0.z : size0.y
  const s = height0 > 1e-4 ? targetH / height0 : 1
  model.scale.multiplyScalar(s)
  root.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(root)
  const center = box.getCenter(new THREE.Vector3())
  // Parent (root) is identity → world offset == local model.position delta.
  model.position.x += -center.x
  model.position.y += -center.y
  model.position.z += -box.min.z
  root.updateMatrixWorld(true)

  return root
}

export async function loadObjectTemplate(detail: ObjectModelDetail): Promise<LoadedObjectTemplate | null> {
  const cached = templateCache.get(detail.name)
  if (cached) return cached

  const job = (async () => {
    try {
      const url = detail.fileUrl || objectModelFileUrl(detail.name)
      const gltf = await loader.loadAsync(url)
      const root = normalizeTemplate(gltf.scene, detail.targetHeightCells)
      return {
        name: detail.name,
        root,
        targetHeightCells: detail.targetHeightCells,
      }
    } catch {
      return null
    }
  })()

  templateCache.set(detail.name, job)
  const result = await job
  if (!result) templateCache.delete(detail.name)
  return result
}

export function clearObjectTemplateCache(): void {
  templateCache.clear()
}

export function disposeObjectTemplate(t: LoadedObjectTemplate | null | undefined): void {
  if (!t) return
  t.root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const mats = mesh.material
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose())
      else mats?.dispose()
    }
  })
}
