/**
 * 角色路电池单测（Workstream · verify）：显式 bone/skeleton/skin → skin_qc → to_rig。
 * 用一个 pig 状 body（torso + head + 4 legs，box parts）+ **手写骨架** 验证：
 *   1. 显式 bone(parent=...) + skeleton(root=...) + skin(method=auto) 构成合法角色 rig
 *   2. skin_qc 拓扑/几何校验通过
 *   3. to_rig 产出 RigSpec（骨架 + 合并网格引用 + skin 参数），不含权重
 *
 * 骨架父子由建模者按解剖显式指定（四条腿各自 parent 到 torso，绝不腿挂腿）。
 */
import { describe, it, expect } from 'vitest'
import { makeGeometry, emit, ref, str, num, numList, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gSkinQc } from '../../batteries/Output/QC/g_skin_qc/index.js'
import { gToRig } from '../../batteries/Output/Export/g_to_rig/index.js'

/** pig 状身体 + 手写骨架：torso 为根，head 与 4 条腿各自挂 torso。 */
function riggedPigGeometry(): Geometry {
  let g = makeGeometry()
  g = emit(g, 'torso', 'box', { size: numList([0.5, 0.3, 0.3]) })
  g = emit(g, 'p_torso', 'part', { shape: ref('torso') })
  g = emit(g, 'headS', 'box', { size: numList([0.2, 0.2, 0.2]) })
  g = emit(g, 'p_head', 'part', { shape: ref('headS'), origin: numList([0.35, 0, 0.1]) })
  const legs: Array<[number, number, number]> = [
    [0, 0.2, 0.12], [1, 0.2, -0.12], [2, -0.2, 0.12], [3, -0.2, -0.12],
  ]
  for (const [i, x, y] of legs) {
    g = emit(g, `legS${i}`, 'box', { size: numList([0.08, 0.08, 0.25]) })
    g = emit(g, `p_leg${i}`, 'part', { shape: ref(`legS${i}`), origin: numList([x, y, -0.25]) })
  }
  // 手写骨架：torso 是根骨，头和四条腿各自挂到 torso（父子按解剖，不腿挂腿）
  g = emit(g, 'bone_torso', 'bone', { origin: numList([0, 0, 0]), tail: numList([0.25, 0, 0]), source_part: ref('p_torso') })
  g = emit(g, 'bone_head', 'bone', { origin: numList([0.35, 0, 0.1]), tail: numList([0.5, 0, 0.1]), parent: ref('bone_torso'), source_part: ref('p_head') })
  for (const [i, x, y] of legs) {
    g = emit(g, `bone_leg${i}`, 'bone', {
      origin: numList([x, y, -0.12]),
      tail: numList([x, y, -0.38]),
      parent: ref('bone_torso'),
      source_part: ref(`p_leg${i}`),
    })
  }
  g = emit(g, 'sk', 'skeleton', { root: ref('bone_torso') })
  g = emit(g, 'skn', 'skin', { skeleton: ref('sk'), method: str('auto') })
  return g
}

describe('character batteries · explicit bone/skeleton/skin → skin_qc → to_rig', () => {
  it('a hand-authored skeleton (torso root + limbs) is a valid rig', () => {
    const g = riggedPigGeometry()
    const bones = g.statements.filter((s) => s.op === 'bone')
    expect(bones).toHaveLength(6) // torso + head + 4 legs
    // root bone (torso) has no parent; every other bone parents to it (never leg-to-leg)
    const rootBone = bones.find((b) => b.id === 'bone_torso')!
    expect(rootBone.args.parent).toBeUndefined()
    expect(bones.filter((b) => b.args.parent).length).toBe(5)
    for (const b of bones) {
      if (b.id === 'bone_torso') continue
      expect(b.args.parent).toEqual(ref('bone_torso'))
    }
  })

  it('skin_qc passes on the hand-authored rig', () => {
    const qc = gSkinQc({ geometry: riggedPigGeometry() })
    expect(qc.valid).toBe(true)
    expect(qc.bones).toBe(6)
    expect(qc.skins).toBe(1)
  })

  it('skin_qc ignores weight_diagnostics when omitted (no runtime solve happened yet)', () => {
    const qc = gSkinQc({ geometry: riggedPigGeometry() })
    const signals = qc.signals as Array<{ code: string }>
    expect(signals.some((s) => s.code.startsWith('skin_unreachable'))).toBe(false)
  })

  it('skin_qc surfaces a non-fatal warning when fed post-solve unreachable diagnostics (object form)', () => {
    const qc = gSkinQc({
      geometry: riggedPigGeometry(),
      weight_diagnostics: { unreachableVertexCount: 3, unreachableBoneNames: ['bone_leg2'] },
    })
    expect(qc.valid).toBe(true) // non-fatal: still valid overall
    const signals = qc.signals as Array<{ code: string; severity: string; message: string; ids?: string[] }>
    const vertexSignal = signals.find((s) => s.code === 'skin_unreachable_vertices')!
    expect(vertexSignal.severity).toBe('warning')
    expect(vertexSignal.message).toContain('3 vertex')
    const boneSignal = signals.find((s) => s.code === 'skin_unreachable_bones')!
    expect(boneSignal.severity).toBe('warning')
    expect(boneSignal.ids).toEqual(['bone_leg2'])
  })

  it('skin_qc also accepts weight_diagnostics as a JSON string', () => {
    const qc = gSkinQc({
      geometry: riggedPigGeometry(),
      weight_diagnostics: JSON.stringify({ unreachableVertexCount: 0, unreachableBoneNames: ['bone_head'] }),
    })
    const signals = qc.signals as Array<{ code: string }>
    expect(signals.some((s) => s.code === 'skin_unreachable_vertices')).toBe(false) // count=0, no signal
    expect(signals.some((s) => s.code === 'skin_unreachable_bones')).toBe(true)
  })

  it('to_rig emits a RigSpec (mesh from wired g_bake_object, no weights)', () => {
    const rig = gToRig({ geometry: riggedPigGeometry(), mesh_filename: 'deadbeef.glb' })
    expect(rig.error).toBe('')
    const spec = rig.rigSpec as {
      boneCount: number; meshFilename: string; skeletonRoot: string
      skin: { method: string }; bones: unknown[]; clips: unknown[]
    }
    expect(spec.boneCount).toBe(6)
    expect(spec.meshFilename).toBe('deadbeef.glb')
    expect(spec.skeletonRoot).toBe('bone_torso')
    expect(spec.skin.method).toBe('auto')
    // RigSpec carries bones but never weights (solved on the frontend).
    expect(JSON.stringify(spec)).not.toContain('skinWeight')
  })

  it('to_rig fails when no skinnable mesh is available', () => {
    const rig = gToRig({ geometry: riggedPigGeometry() }) // no mesh_filename wired
    expect(rig.rigSpec).toBeNull()
    expect(String(rig.error)).toContain('skinnable mesh')
  })

  it('to_rig passes authored bone(axis=…) through to RigSpec', () => {
    let g = makeGeometry()
    g = emit(g, 'torso', 'box', { size: numList([0.4, 0.2, 0.2]) })
    g = emit(g, 'p_torso', 'part', { shape: ref('torso') })
    g = emit(g, 'legS', 'box', { size: numList([0.08, 0.08, 0.25]) })
    g = emit(g, 'p_leg', 'part', { shape: ref('legS'), origin: numList([0.2, 0.12, -0.25]) })
    g = emit(g, 'bone_torso', 'bone', {
      origin: numList([0, 0, 0]),
      tail: numList([0.25, 0, 0]),
      source_part: ref('p_torso'),
    })
    // 行走腿：显式 axis=[0,1,0]（前后摆），不靠启发式
    g = emit(g, 'bone_leg', 'bone', {
      origin: numList([0.2, 0.12, -0.12]),
      tail: numList([0.2, 0.12, -0.38]),
      axis: numList([0, 1, 0]),
      parent: ref('bone_torso'),
      source_part: ref('p_leg'),
    })
    g = emit(g, 'sk', 'skeleton', { root: ref('bone_torso') })
    g = emit(g, 'skn', 'skin', { skeleton: ref('sk'), method: str('auto') })

    const rig = gToRig({ geometry: g, mesh_filename: 'deadbeef.glb' })
    expect(rig.error).toBe('')
    const spec = rig.rigSpec as {
      bones: Array<{ name: string; axis?: [number, number, number] }>
    }
    const leg = spec.bones.find((b) => b.name === 'bone_leg')!
    expect(leg.axis).toEqual([0, 1, 0])
    const torso = spec.bones.find((b) => b.name === 'bone_torso')!
    expect(torso.axis).toBeUndefined()
  })

  /** Minimal one-bone rig, parameterized by an explicit skin(resolution=...) (or omitted). */
  function minimalRigGeometry(resolution: number | undefined): Geometry {
    let g = makeGeometry()
    g = emit(g, 'torso', 'box', { size: numList([0.4, 0.2, 0.2]) })
    g = emit(g, 'p_torso', 'part', { shape: ref('torso') })
    g = emit(g, 'bone_torso', 'bone', { origin: numList([0, 0, 0]), tail: numList([0.25, 0, 0]), source_part: ref('p_torso') })
    g = emit(g, 'sk', 'skeleton', { root: ref('bone_torso') })
    g = emit(g, 'skn', 'skin', {
      skeleton: ref('sk'),
      method: str('auto'),
      ...(resolution === undefined ? {} : { resolution: num(resolution) }),
    })
    return g
  }

  it.each([
    [undefined, 48], // omitted → default
    [1, 4], // below MIN_RESOLUTION → clamps up
    [4, 4], // at MIN_RESOLUTION → unchanged
    [96, 96], // at MAX_RESOLUTION → unchanged
    [256, 96], // above MAX_RESOLUTION → clamps down (old bound was 256; must now match voxel-skin.ts)
  ])('to_rig clamps skin(resolution=%s) to %s, matching frontend voxel-skin.ts MIN/MAX_RESOLUTION [4,96]', (input, expected) => {
    const rig = gToRig({ geometry: minimalRigGeometry(input), mesh_filename: 'deadbeef.glb' })
    expect(rig.error).toBe('')
    const spec = rig.rigSpec as { skin: { resolution: number } }
    expect(spec.skin.resolution).toBe(expected)
  })

  it('to_rig passes validated root translation to the unique skeleton root clip', () => {
    let g = riggedPigGeometry()
    g = emit(g, 'jump', 'animation', {
      q_json: str(JSON.stringify({
        name: 'jump',
        fps: 2,
        frameCount: 3,
        loop: false,
        channels: { bone_leg0: [0, -0.4, 0] },
        rootTranslation: [[0, 0, 0], [0.2, 0, 0.8], [0.4, 0, 0]],
      })),
    })
    const rig = gToRig({ geometry: g, mesh_filename: 'deadbeef.glb' })
    expect(rig.error).toBe('')
    const spec = rig.rigSpec as {
      skeletonRoot: string
      clips: Array<{
        channels: Record<string, number[]>
        rootTranslation?: [number, number, number][]
      }>
    }
    expect(spec.skeletonRoot).toBe('bone_torso')
    expect(spec.clips[0].channels.bone_leg0).toEqual([0, -0.4, 0])
    expect(spec.clips[0].rootTranslation).toEqual([
      [0, 0, 0],
      [0.2, 0, 0.8],
      [0.4, 0, 0],
    ])
  })
})
