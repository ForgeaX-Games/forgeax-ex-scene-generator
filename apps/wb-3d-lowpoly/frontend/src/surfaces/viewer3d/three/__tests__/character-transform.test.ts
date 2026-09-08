// 💡 角色 rest 姿态坐标对齐回归：可蒙皮网格渲染顶点必须与骨架处在同一世界变换下
//    （Y-up group 只作用一次）。要点：SkinnedMesh 用默认 AttachedBindMode——three 每帧把
//    bindMatrixInverse 重设为 inverse(mesh.matrixWorld)，抵消网格自身 group 变换，于是渲染
//    = boneMatrix·pos。boneInverses 在挂 group 之前（纯模型帧）算好 → boneMatrix=group →
//    渲染 = group·pos，与骨架对齐。⚠️ 若挂 group 后再 calculateInverses，boneMatrix=I，group
//    会被 bindMatrixInverse 抵消，网格塌回模型帧、与骨架错位——这条测试守住该不变量。
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildCharacterSkeleton, buildCharacterSkinnedMeshes } from '../character-builder'
import type { RigSpec } from '../rig-spec'

const RIG: RigSpec = {
  version: 1,
  meshFilename: 'x.glb',
  skeletonRoot: 'root',
  bones: [{ name: 'root', parent: null, head: [0, 0, 0], tail: [0, 0, 1] }],
  boneCount: 1,
  skin: { method: 'auto', resolution: 32, maxInfluences: 4, falloff: 2 },
  clips: [],
}

describe('character rest-pose transform', () => {
  it('skinned mesh vertex aligns with the skeleton (single Y-up group transform)', () => {
    const cs = buildCharacterSkeleton(RIG)
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1], 3)) // model-frame (0,0,1)
    const loaded = new THREE.Group()
    loaded.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial()))
    const meshes = buildCharacterSkinnedMeshes(loaded, cs, RIG.skin, 'k')
    const sm = meshes[0]

    // Replicate useViewer3DScene character branch exactly: rootBone + skinned
    // meshes under the Y-up group, then updateMatrixWorld (which, in AttachedBindMode,
    // refreshes bindMatrixInverse = inverse(matrixWorld)). No calculateInverses here.
    const group = new THREE.Group()
    group.rotation.x = -Math.PI / 2
    group.add(cs.rootBone)
    group.add(sm)
    group.updateMatrixWorld(true)

    // Where the SKELETON puts the bone tip (model-frame (0,0,1)) in world:
    const skeletonPoint = new THREE.Vector3(0, 0, 1).applyMatrix4(group.matrixWorld)

    // Where the SKINNED MESH renders that vertex. NB: this three version's
    // applyBoneTransform reads the base position FROM the passed target, then writes
    // the skinned result back into it; the result is already in world space here
    // because AttachedBindMode's bindMatrixInverse cancels mesh.matrixWorld.
    const skinned = new THREE.Vector3().fromBufferAttribute(sm.geometry.attributes.position, 0)
    sm.applyBoneTransform(0, skinned)
    const skinnedWorld = skinned.applyMatrix4(sm.matrixWorld)

    expect(skinnedWorld.x).toBeCloseTo(skeletonPoint.x, 4)
    expect(skinnedWorld.y).toBeCloseTo(skeletonPoint.y, 4)
    expect(skinnedWorld.z).toBeCloseTo(skeletonPoint.z, 4)
  })
})
