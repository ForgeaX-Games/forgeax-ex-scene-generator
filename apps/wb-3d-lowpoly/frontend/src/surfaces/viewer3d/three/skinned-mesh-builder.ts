// 💡 骨骼蒙皮导出：从活跃场景收集带 link 标记的可见 mesh，把顶点烘焙进骨骼绑定空间，
//    构造刚性权重（每个 mesh 100% 绑定一根骨骼）的 THREE.SkinnedMesh。
//    只读活跃场景（不改动任何实时渲染对象）；几何体 clone 后再 applyMatrix4 烘焙。
import * as THREE from 'three'
import type { UrdfSpec } from './urdf-parser'
import type { BindSkeleton } from './skeleton-builder'

/** 与 scene-graph-builder.ts / selection-highlight.ts 共享的 link 标记 key。 */
const LINK_USER_DATA_KEY = 'urdfLinkName'

interface LinkOwner {
  linkName: string
  /** 承载该 link 所有 mesh 的祖先节点（同步/异步来源都适用），用于取 matrixWorld。 */
  linkNode: THREE.Object3D
}

/**
 * 从 mesh 向上找到"拥有该 mesh 的 link 节点"：沿父链一直走到场景根，取路径上
 * 最后一个（离场景根最近、即最外层）带 `userData.urdfLinkName` 标记的节点——
 * link group 本身以及它内部的同步/异步 mesh 容器都可能带这个标记（见
 * scene-graph-builder.ts + useViewer3DScene.ts 的异步分支），取最外层才能保证得到
 * 的是真正的 "link:<name>" Group，而不是内部某层嵌套 wrapper。
 */
function resolveLinkOwner(mesh: THREE.Object3D): LinkOwner | null {
  let linkName: string | undefined
  let linkNode: THREE.Object3D | null = null
  let cur: THREE.Object3D | null = mesh.parent
  while (cur) {
    const tag = cur.userData?.[LINK_USER_DATA_KEY]
    if (typeof tag === 'string' && tag) {
      linkName = tag
      linkNode = cur
    }
    cur = cur.parent
  }
  return linkNode && linkName ? { linkName, linkNode } : null
}

/**
 * 收集 `exportRoot` 里所有可见的 URDF 可视 mesh，按其所属 link 找到对应骨骼，
 * 把 mesh 顶点烘焙进该骨骼的绑定姿态世界空间，构造刚性蒙皮的 SkinnedMesh：
 * - geometry：mesh.geometry 的独立 clone，`applyMatrix4(boneBindWorldMatrix · linkNode.matrixWorld⁻¹ · mesh.matrixWorld)` 烘焙顶点；
 * - skinIndex/skinWeight：全顶点常量填充（该骨骼下标 / [1,0,0,0]），不做权重混合；
 * - SkinnedMesh 自身变换保持单位矩阵，`bind(skeleton, identity)`，避免额外坐标系推导。
 * 找不到所属骨骼（既不在任何 joint.child 也不是根 link）的 mesh 会被跳过并警告。
 */
export function buildSkinnedMeshes(
  exportRoot: THREE.Object3D,
  spec: UrdfSpec,
  bindSkeleton: BindSkeleton,
): THREE.SkinnedMesh[] {
  const { rootBone, boneByJointName, boneIndex, skeleton } = bindSkeleton
  exportRoot.updateMatrixWorld(true)

  const boneByLink = new Map<string, THREE.Bone>()
  for (const joint of spec.joints) {
    const bone = boneByJointName.get(joint.name)
    if (bone) boneByLink.set(joint.child, bone)
  }

  const meshes: THREE.SkinnedMesh[] = []
  const linkWorldInverse = new THREE.Matrix4()
  const bakeMatrix = new THREE.Matrix4()
  const identity = new THREE.Matrix4()

  exportRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return
    if (!object.visible) return
    const geometry = object.geometry
    if (!geometry || !geometry.attributes.position) return

    const owner = resolveLinkOwner(object)
    if (!owner) {
      console.warn('[viewer/skinned-mesh-builder] mesh has no resolvable owning link, skipped', { name: object.name })
      return
    }

    const targetBone = boneByLink.get(owner.linkName) ?? rootBone
    const boneIdx = boneIndex.get(targetBone)
    if (boneIdx === undefined) {
      console.warn('[viewer/skinned-mesh-builder] mesh owning bone not found in skeleton, skipped', { name: object.name, link: owner.linkName })
      return
    }

    linkWorldInverse.copy(owner.linkNode.matrixWorld).invert()
    bakeMatrix.copy(targetBone.matrixWorld).multiply(linkWorldInverse).multiply(object.matrixWorld)

    const bakedGeometry = geometry.clone()
    bakedGeometry.applyMatrix4(bakeMatrix)

    const vertexCount = bakedGeometry.attributes.position.count
    const skinIndices = new Uint16Array(vertexCount * 4)
    const skinWeights = new Float32Array(vertexCount * 4)
    for (let v = 0; v < vertexCount; v += 1) {
      skinIndices[v * 4] = boneIdx
      skinWeights[v * 4] = 1
    }
    bakedGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
    bakedGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))

    const skinnedMesh = new THREE.SkinnedMesh(bakedGeometry, object.material)
    skinnedMesh.name = object.name || `skinned:${owner.linkName}`
    skinnedMesh.castShadow = object.castShadow
    skinnedMesh.receiveShadow = object.receiveShadow
    skinnedMesh.bind(skeleton, identity)
    meshes.push(skinnedMesh)
  })

  return meshes
}
