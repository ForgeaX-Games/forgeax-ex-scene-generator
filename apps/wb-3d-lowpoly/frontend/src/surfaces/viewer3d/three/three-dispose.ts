// 💡 共享 three.js 资源释放工具：把一棵 Object3D 子树里所有 GPU 资源
//    （geometry / material / material 上挂的 texture）彻底 dispose，杜绝
//    重复 build / clone 场景图导致的 GPU 内存泄漏。
//
// 为什么单独抽一个模块：useThreeScene 的场景清理、useViewer3DScene 的换模型清理、
// 导出克隆的释放、geometry 模板缓存淘汰——这几处此前各写各的，且都只 dispose
// Mesh、漏掉 Line/LineSegments/Points 与 material 上的 texture。统一到这里。
import * as THREE from 'three'

const TEXTURE_KEYS: readonly string[] = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'gradientMap',
]

/** 释放单个材质及其挂载的所有贴图。失败时静默（资源可能已被回收）。 */
export function disposeMaterial(material: THREE.Material): void {
  const record = material as unknown as Record<string, unknown>
  for (const key of TEXTURE_KEYS) {
    const value = record[key]
    if (value instanceof THREE.Texture) value.dispose()
  }
  material.dispose()
}

function disposeMaterialField(
  material: THREE.Material | THREE.Material[] | null | undefined,
): void {
  if (!material) return
  if (Array.isArray(material)) material.forEach(disposeMaterial)
  else disposeMaterial(material)
}

/**
 * 深度克隆一棵子树用于导出：three.js `clone(true)` 会共享 geometry 与 material，
 * 直接 dispose 克隆会连带释放仍在场景里使用的共享 GPU buffer。导出（OBJ/GLB）需要
 * 一份可独立 dispose 的副本——这里给每个 Mesh 复制独立的 geometry + material，
 * 用完后对返回值调 disposeObject3D 即可安全释放，不影响实时视图。
 */
export function cloneObject3DForExport(root: THREE.Object3D): THREE.Object3D {
  const clone = root.clone(true)
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (child.geometry) child.geometry = child.geometry.clone()
    const material = child.material
    if (Array.isArray(material)) child.material = material.map((m) => m.clone())
    else if (material) child.material = material.clone()
  })
  return clone
}

/**
 * 深度遍历并释放整棵子树的 GPU 资源：Mesh / Line / LineSegments / Points 的
 * geometry + material(+texture)。仅释放资源，不从父节点移除（调用方负责 remove）。
 *
 * ⚠️ 只对"拥有独立 geometry/material"的子树调用（场景 root、cloneObject3DForExport
 * 的产物、geometry-loader 的独立克隆）。不要对 three.js `clone()` 的浅共享克隆调用，
 * 否则会释放仍被实时场景使用的共享资源。
 */
export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const withGeometry = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ) {
      withGeometry.geometry?.dispose()
      disposeMaterialField(withGeometry.material)
    }
  })
}
