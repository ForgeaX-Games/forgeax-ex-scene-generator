// 💡 角色骨架的**可视骨形**：Blender 风格八面体骨（head→tail 有体积的锥体），
//    取代 THREE.SkeletonHelper 的「关节连线」呈现。
//
//    每根骨的八面体作为**该骨的子节点**挂上去（bone.add），因此天然随动画的
//    bone.quaternion 一起摆动，无需每帧手动更新——与 SkinnedMesh 一致靠 matrixWorld 传播。
//
//    朝向约定：rest 姿态下骨的局部帧 == 模型根帧（见 character-builder.ts），骨原点落在
//    head，所以在骨局部空间里 tail 方向 = normalize(tail_model − head_model)、长度 = |tail−head|。
//    以「+Y、长度 1、领环在 0.1 处、半径 0.1」的单位八面体为模板，按方向/长度定位即可。
import * as THREE from 'three'
import type { CharacterSkeleton } from './character-builder'

const BONE_FILL_COLOR = 0x63b3ff
const BONE_EDGE_COLOR = 0x0a2540
const JOINT_COLOR = 0xffcc55
const OVERLAY_RENDER_ORDER = 20
/** 领环相对骨长的位置与半径（Blender 默认八面体比例）。 */
const COLLAR = 0.1
/** 退化骨（head≈tail）阈值：低于此长度只画关节球，不画骨锥。 */
const MIN_BONE_LEN = 1e-4

const UP_Y = new THREE.Vector3(0, 1, 0)

/** 单位八面体骨几何：head=(0,0,0)，tail=(0,1,0)，中部领环（正方形截面）在 y=0.1、半径 0.1。 */
function makeUnitBoneGeometry(): THREE.BufferGeometry {
  const c = COLLAR
  // 6 顶点：head, tail, 领环 4 点（+x, +z, −x, −z）。
  const positions = new Float32Array([
    0, 0, 0, // 0 head
    0, 1, 0, // 1 tail
    c, c, 0, // 2 +x
    0, c, c, // 3 +z
    -c, c, 0, // 4 −x
    0, c, -c, // 5 −z
  ])
  // 8 面（下锥 4 + 上锥 4），逆时针朝外。
  const index = [
    0, 3, 2, 0, 4, 3, 0, 5, 4, 0, 2, 5, // head → 领环
    1, 2, 3, 1, 3, 4, 1, 4, 5, 1, 5, 2, // 领环 → tail
  ]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

export interface BoneShapes {
  /** 生成的骨形数量（画出的骨锥数）。 */
  count: number
}

/**
 * 为 skeleton 的每根骨生成八面体骨形 + head 关节球，并挂到对应 bone 下。
 * 资源随所属 bone 子树被 disposeObject3D(characterRoot) 统一释放（几何/材质均为独立实例）。
 */
export function buildBoneShapes(skeleton: CharacterSkeleton): BoneShapes {
  const { bones, segments } = skeleton
  const unit = makeUnitBoneGeometry()

  let count = 0
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i]
    const seg = segments[i]
    // head 关节球（骨局部原点 = head）。
    bone.add(makeJoint())

    if (!seg) continue
    const dir = new THREE.Vector3().subVectors(seg.tail, seg.head)
    const len = dir.length()
    if (len < MIN_BONE_LEN) continue
    dir.multiplyScalar(1 / len)

    const mesh = makeBoneMesh(unit)
    mesh.quaternion.setFromUnitVectors(UP_Y, dir)
    mesh.scale.setScalar(len)
    bone.add(mesh)
    count += 1
  }

  // 模板不再直接使用（每根骨已 clone 独立几何），释放它。
  unit.dispose()
  return { count }
}

function makeBoneMesh(unit: THREE.BufferGeometry): THREE.Object3D {
  const geometry = unit.clone()
  const fill = new THREE.MeshStandardMaterial({
    color: BONE_FILL_COLOR,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, fill)
  mesh.renderOrder = OVERLAY_RENDER_ORDER
  mesh.castShadow = false
  mesh.receiveShadow = false

  // 棱线：突出八面体轮廓，让「骨」比纯色块更清晰。
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: BONE_EDGE_COLOR, depthTest: false, transparent: true, opacity: 0.9 }),
  )
  edges.renderOrder = OVERLAY_RENDER_ORDER + 1
  mesh.add(edges)
  return mesh
}

let jointGeometry: THREE.SphereGeometry | null = null

function makeJoint(): THREE.Object3D {
  // 关节球半径固定（模型帧米），够小以免遮住骨锥；每根骨独立材质便于统一 dispose。
  const geometry = (jointGeometry ??= new THREE.SphereGeometry(1, 10, 8)).clone()
  const material = new THREE.MeshStandardMaterial({
    color: JOINT_COLOR,
    flatShading: true,
    roughness: 0.5,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  })
  const sphere = new THREE.Mesh(geometry, material)
  sphere.scale.setScalar(0.012)
  sphere.renderOrder = OVERLAY_RENDER_ORDER + 2
  sphere.castShadow = false
  sphere.receiveShadow = false
  return sphere
}

export default buildBoneShapes
