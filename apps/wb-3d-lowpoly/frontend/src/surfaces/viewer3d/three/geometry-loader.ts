// 💡 几何体构建器：URDF box/cylinder/sphere/mesh → THREE.Mesh
//    primitives 同步构建；mesh 文件（glb/gltf/obj）走异步 loader + 模板缓存
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import type { UrdfVisualGeometry } from './urdf-parser'
import type { MaterialSpec } from './materials'
import { createMaterial, createEdgeLines } from './materials'
import { disposeObject3D } from './three-dispose'

export interface LoadGeometryOptions {
  kind?: 'visual' | 'collision'
  materialSpec?: MaterialSpec
  doubleSided?: boolean
  depthBias?: number
  assetRevisionKey?: string | null
}

// mesh 模板缓存：URL → 已加载模板（每个 URDF link 各自 clone 一份，模板本身永不进
// 场景）。这里用一个有上限的 LRU：模型迭代 / 切换会持续解析新的 baked OBJ（每次 bake
// 的 sha 不同 → URL 不同），无界缓存会让所有历史模板的 GPU 资源永久驻留。淘汰最久未用
// 的条目时，把已解析模板的 geometry/material/texture 一并 dispose。
const MAX_TEMPLATE_CACHE_ENTRIES = 48
const geometryTemplateCache = new Map<string, Promise<THREE.Object3D>>()

function touchCacheEntry(url: string, entry: Promise<THREE.Object3D>): void {
  // Map 保持插入顺序：删除再设置 → 移到"最近使用"末尾。
  geometryTemplateCache.delete(url)
  geometryTemplateCache.set(url, entry)
}

function evictIfOverCapacity(): void {
  while (geometryTemplateCache.size > MAX_TEMPLATE_CACHE_ENTRIES) {
    const oldest = geometryTemplateCache.keys().next()
    if (oldest.done) break
    const url = oldest.value
    const evicted = geometryTemplateCache.get(url)
    geometryTemplateCache.delete(url)
    // 模板可能仍在加载；解析后再 dispose（已 reject 的会被 catch 忽略）。
    void evicted?.then((template) => disposeObject3D(template)).catch(() => undefined)
  }
}

/** 测试 / 手动失效用：清空模板缓存并释放所有已解析模板的 GPU 资源。 */
export function clearGeometryTemplateCache(): void {
  for (const entry of geometryTemplateCache.values()) {
    void entry.then((template) => disposeObject3D(template)).catch(() => undefined)
  }
  geometryTemplateCache.clear()
}

function appendRevisionParam(url: string, assetRevisionKey: string | null | undefined): string {
  if (!assetRevisionKey) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}rev=${encodeURIComponent(assetRevisionKey)}`
}

function cloneCachedObject(root: THREE.Object3D): THREE.Object3D {
  // three.js `clone()` shares BufferGeometry *and* materials with the template.
  // We give each clone its own geometry + materials so the cached template can
  // be disposed on LRU eviction without corrupting clones still live in the
  // scene (which would otherwise share the freed GPU buffers).
  const clone = root.clone(true)
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (child.geometry) child.geometry = child.geometry.clone()
    const material = child.material
    if (Array.isArray(material)) {
      child.material = material.map((entry) => entry.clone())
      return
    }
    if (material) child.material = material.clone()
  })
  return clone
}

function loadGeometryTemplate(resolvedUrl: string, extension: string | undefined): Promise<THREE.Object3D> {
  const cached = geometryTemplateCache.get(resolvedUrl)
  if (cached) {
    touchCacheEntry(resolvedUrl, cached)
    return cached
  }

  const pending = (async () => {
    if (extension === 'glb' || extension === 'gltf') {
      const loader = new GLTFLoader()
      const gltf = await loader.loadAsync(resolvedUrl)
      return gltf.scene
    }
    if (extension === 'obj') {
      const loader = new OBJLoader()
      return loader.loadAsync(resolvedUrl)
    }
    throw new Error(`Unsupported mesh file format for ${resolvedUrl}`)
  })()

  geometryTemplateCache.set(resolvedUrl, pending)
  evictIfOverCapacity()
  void pending.catch(() => {
    if (geometryTemplateCache.get(resolvedUrl) === pending) {
      geometryTemplateCache.delete(resolvedUrl)
    }
  })
  return pending
}

/**
 * 从 URDF primitive geometry 构建 mesh。mesh-type 返回 null，需要走 loadGeometryObject。
 */
export function buildPrimitiveMesh(
  geometry: UrdfVisualGeometry,
  materialSpec: MaterialSpec,
  options: Pick<LoadGeometryOptions, 'doubleSided' | 'depthBias'> = {},
): THREE.Mesh | null {
  let bufferGeometry: THREE.BufferGeometry

  switch (geometry.type) {
    case 'box': {
      const [x, y, z] = geometry.size ?? [1, 1, 1]
      bufferGeometry = new THREE.BoxGeometry(x, y, z)
      break
    }
    case 'cylinder': {
      const radius = geometry.radius ?? 1
      const length = geometry.length ?? 1
      bufferGeometry = new THREE.CylinderGeometry(radius, radius, length, 32)
      // URDF cylinder 沿 Z 轴；THREE.CylinderGeometry 沿 Y 轴，所以绕 X 旋转 90°
      bufferGeometry.rotateX(Math.PI / 2)
      break
    }
    case 'sphere': {
      const radius = geometry.radius ?? 1
      bufferGeometry = new THREE.SphereGeometry(radius, 32, 16)
      break
    }
    default:
      return null
  }

  const material = createMaterial(materialSpec, {
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    depthBias: options.depthBias,
  })
  const mesh = new THREE.Mesh(bufferGeometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * 加载 URDF mesh 几何引用的外部模型文件（glb / gltf / obj）。
 */
export async function loadGeometryObject(
  geometry: UrdfVisualGeometry,
  baseUrl: string,
  options: LoadGeometryOptions = {},
): Promise<THREE.Group> {
  if (geometry.type !== 'mesh' || !geometry.filename) {
    throw new Error('loadGeometryObject requires a mesh geometry with a filename')
  }
  const filename = geometry.filename
  const url = baseUrl.endsWith('/') ? `${baseUrl}${filename}` : `${baseUrl}/${filename}`
  const resolvedUrl = appendRevisionParam(url, options.assetRevisionKey)

  const extension = filename.split('.').pop()?.toLowerCase()
  const scale = geometry.scale ?? [1, 1, 1]
  if (extension !== 'glb' && extension !== 'gltf' && extension !== 'obj') {
    throw new Error(`Unsupported mesh file format: .${extension} (${filename})`)
  }

  const template = await loadGeometryTemplate(resolvedUrl, extension)
  const group = new THREE.Group()
  group.add(cloneCachedObject(template))
  group.scale.set(scale[0], scale[1], scale[2])
  applyLoadedMeshPresentation(group, options)
  return group
}

function applyLoadedMeshPresentation(root: THREE.Object3D, options: LoadGeometryOptions): void {
  const kind = options.kind ?? 'visual'
  const materialSpec = options.materialSpec
  const side = options.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  const depthBias = options.depthBias

  // 低多边形意图：烘焙出的可视网格用平面/faceted 着色（逐面法线），而不是把法线平滑插值
  // 成"圆润"外观。collision 是半透明叠加层，维持原状。
  const flat = kind === 'visual'

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals()

    if (materialSpec) {
      child.material = kind === 'collision'
        ? createMaterial(materialSpec, { side, transparent: true, depthBias })
        : createMaterial(materialSpec, { side, depthBias, flatShading: flat })
    } else if (flat) {
      // GLB 自带材质（如彩色装配）：直接打开 flatShading 贴合低多边形。
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of mats) {
        if (m && 'flatShading' in m) {
          ;(m as THREE.MeshStandardMaterial).flatShading = true
          m.needsUpdate = true
        }
      }
    }

    child.castShadow = kind === 'visual'
    child.receiveShadow = kind === 'visual'
    child.userData.urdfVisual = kind === 'visual'
    child.userData.urdfCollision = kind === 'collision'
    child.visible = kind === 'visual'

    if (kind === 'collision') {
      child.renderOrder = 10
      child.add(createEdgeLines(child.geometry, materialSpec?.color.getHex() ?? 0x000000))
    }
  })
}
