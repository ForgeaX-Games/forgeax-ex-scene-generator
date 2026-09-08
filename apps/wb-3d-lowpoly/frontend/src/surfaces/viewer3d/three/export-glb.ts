// 💡 导出带动画的 GLB：烘焙 URDF 关节预览轨迹为 glTF animation
import * as THREE from 'three'
import type { UrdfSpec } from './urdf-parser'
import {
  buildAuthoredAnimationClip,
  buildUrdfPreviewAnimationClip,
  findJointMotionNodes,
  previewAnimationDuration,
  type AuthoredJointAnimationClip,
} from './urdf-joint-motion'
import { buildBindSkeleton } from './skeleton-builder'
import { buildSkinnedMeshes } from './skinned-mesh-builder'
import { buildBoneAnimationClip } from './bone-animation'

/** PropertyBinding / glTF 会把 `.` `:` `/` 当作路径分隔符，URDF 节点名需先清洗。 */
const GLTF_RESERVED_IN_NAME_RE = /[[\].:/\s]/g

export function sanitizeGltfNodeName(name: string): string {
  const cleaned = name.replace(GLTF_RESERVED_IN_NAME_RE, '_').replace(/_+/g, '_')
  return cleaned.replace(/^_|_$/g, '') || 'node'
}

export function sanitizeExportSceneNames(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj.name) obj.name = sanitizeGltfNodeName(obj.name)
  })
}

// 共享的 GLTFExporter 出口：唯一区别是是否带 `animations`。两个 public 导出函数
// （动画版 / 静态版）各自在调用前做好场景名清洗与（可选的）clip 构建。
async function parseToGlbBlob(
  exportRoot: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<Blob> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const glb = await new Promise<ArrayBuffer | object>((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      exportRoot,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, onlyVisible: true, animations },
    )
  })

  return glb instanceof ArrayBuffer
    ? new Blob([glb], { type: 'model/gltf-binary' })
    : new Blob([JSON.stringify(glb)], { type: 'model/gltf+json' })
}

// 带动画的 GLB：把关节轨迹烘成 glTF animation track。需要 spec 来推导每个关节的
// 运动范围 / mimic 关系；clip 必须在 sanitize 之后构建，否则 track 的目标节点名对不上。
// 有作者 clip（authoredClip，来自 g_bake_animation）就烘它，否则回退到程序化预览。
export async function exportAnimatedGlbBlob(
  exportRoot: THREE.Object3D,
  spec: UrdfSpec,
  authoredClip?: AuthoredJointAnimationClip | null,
): Promise<Blob> {
  const jointNodes = findJointMotionNodes(exportRoot)
  sanitizeExportSceneNames(exportRoot)
  const clip = authoredClip
    ? buildAuthoredAnimationClip(spec, authoredClip, jointNodes, exportRoot)
    : buildUrdfPreviewAnimationClip(spec, jointNodes, exportRoot)
  return parseToGlbBlob(exportRoot, clip ? [clip] : [])
}

// 静态 GLB：只导出几何 + 内嵌材质，**不写任何 animation track**。给那些不需要
// 关节预览动画（或会被引擎里的骨骼/动画系统接管）的消费方用。无需 UrdfSpec。
export async function exportStaticGlbBlob(exportRoot: THREE.Object3D): Promise<Blob> {
  sanitizeExportSceneNames(exportRoot)
  return parseToGlbBlob(exportRoot, [])
}

export function glbExportHasAnimation(spec: UrdfSpec): boolean {
  return previewAnimationDuration(spec) > 0
}

// 骨骼蒙皮 GLB：产出标准 skins（Bone 节点 + SkinnedMesh + 权重），每个 link 的网格
// 100% 权重刚性绑定到对应 joint 的骨骼上（不做关节处平滑混合）。`exportRoot` 传入
// 活跃场景的实时根节点即可——本函数只读它的 matrixWorld/geometry/material，不会
// 修改或需要调用方预先 clone；蒙皮网格自己 clone 了独立几何体，导出后就地释放。
//
// 骨骼树整体套一层与 `exportRoot` 自身变换一致的外层 Y-up 旋转（+落地位移），只包一次，
// 不烘进骨骼/几何体内部，与另外两种 GLB 导出打开效果保持一致（见 useViewer3DScene.ts 里
// `__viewer_robot__` 的 `rotation.x = -Math.PI/2` + 落地归一化）。
// 角色骨骼蒙皮 GLB：直接导出活跃的 character 容器（rootBone + SkinnedMesh，权重由
// auto-skin 求得）+ 骨骼动画 clip（骨骼名通道，绕局部 X 弯曲）。骨骼名 / 网格名已是
// glTF 合法（bone_* / skinned_*），无需 sanitize（sanitize 会改名导致 clip track 目标
// 对不上）。导出前通过 Skeleton.pose() 恢复完整 bind transform（position/quaternion/scale）——
// 预览 mixer 可能正处于动画中途，尤其根运动会改根骨 position；clip 自身完整编码动作。
export async function exportCharacterGlbBlob(
  characterRoot: THREE.Object3D,
  clips: THREE.AnimationClip[],
): Promise<Blob> {
  const skeletons = new Set<THREE.Skeleton>()
  characterRoot.traverse((obj) => {
    if (obj instanceof THREE.SkinnedMesh) skeletons.add(obj.skeleton)
  })
  for (const skeleton of skeletons) skeleton.pose()
  characterRoot.updateMatrixWorld(true)
  return parseToGlbBlob(characterRoot, clips)
}

export async function exportSkinnedGlbBlob(
  exportRoot: THREE.Object3D,
  spec: UrdfSpec,
  authoredClip?: AuthoredJointAnimationClip | null,
): Promise<Blob> {
  const bindSkeleton = buildBindSkeleton(spec)
  const skinnedMeshes = buildSkinnedMeshes(exportRoot, spec, bindSkeleton)

  const container = new THREE.Group()
  container.name = 'urdf_skinned_export_root'
  container.position.copy(exportRoot.position)
  container.quaternion.copy(exportRoot.quaternion)
  container.scale.copy(exportRoot.scale)
  container.add(bindSkeleton.rootBone)
  for (const mesh of skinnedMeshes) container.add(mesh)

  sanitizeExportSceneNames(container)
  const clip = buildBoneAnimationClip(spec, bindSkeleton.boneByJointName, authoredClip)

  try {
    return await parseToGlbBlob(container, clip ? [clip] : [])
  } finally {
    // 蒙皮网格的几何体是我们自己 clone 出来的独立副本，导出后就地释放；材质是
    // 直接借用活跃场景的引用（未 clone），绝不能在这里 dispose，否则会破坏实时渲染。
    for (const mesh of skinnedMeshes) mesh.geometry.dispose()
    bindSkeleton.skeleton.dispose()
  }
}
