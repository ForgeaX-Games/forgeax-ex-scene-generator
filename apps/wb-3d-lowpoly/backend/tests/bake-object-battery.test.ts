/**
 * g_bake_object 电池单测 —— 重点是 `include_mesh_parts` 这个分区开关。
 *
 * 角色路依赖"把逐件预烘的 <sha>.obj 一并回读合并成单张可蒙皮网格"，所以默认必须是 true。
 * 静态路终端链传 false：那里 mesh-ref part 由 g_to_scene 各列一条 SceneSpec item，两边都收
 * 会让同一件在场景里出现两遍。
 */
import { describe, it, expect } from 'vitest'
import { makeGeometry, emit, num, numList, ref, str, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gBakeObject } from '../../batteries/Output/Bake/g_bake_object/index.js'

interface AssemblyPart { shapeId: string; origin?: [number, number, number] }
interface RegisteredPart { name: string; filename: string; sha256: string; bbox_min: number[]; bbox_max: number[]; dims: number[] }

function fakeBaker() {
  const calls: AssemblyPart[][] = []
  const registered: RegisteredPart[] = []
  return {
    calls,
    registered,
    ctx: {
      services: {
        baker: {
          async bakeColoredAssembly(parts: readonly AssemblyPart[]) {
            calls.push(parts.map((p) => ({ ...p })))
            return {
              url: 'obj3ct.glb',
              sha256: 'obj3ct',
              vertexCount: 96,
              triangleCount: 48,
              byteSize: 4096,
              cacheHit: false,
              bboxMin: [-1, -1, 0] as [number, number, number],
              bboxMax: [1, 1, 2] as [number, number, number],
            }
          },
        },
        parts: {
          register(entry: RegisteredPart) {
            registered.push(entry)
          },
        },
      },
    },
  }
}

/**
 * 一栋混合模型：手写的真形状屋顶 + 一层预烘好的 storey mesh 引用。
 *
 * `lv` 的 `<sha>.glb` 是 `g_storey_stack` 合并楼层的产物——这类 mesh 引用只在**静态路**
 * 出现，且静态路终端链总是显式传 `include_mesh_parts=false`（真 baker 也读不了 .glb 的
 * 裸三角面，见 baker.service.ts 的 loadMeshPartRawMesh），所以这份 fixture 只用于
 * `include_mesh_parts=false` 的分区测试。
 */
function mixedBuilding(): Geometry {
  let g = makeGeometry()
  g = emit(g, 'mat', 'material', { rgba: numList([0.7, 0.3, 0.25, 1]) })
  g = emit(g, 'lv', 'mesh', { filename: str('storey.glb'), bbox_min: numList([-6, -5, 0]), bbox_max: numList([6, 5, 3.2]) })
  g = emit(g, 'p_lv1', 'part', { shape: ref('lv') })
  g = emit(g, 'p_lv2', 'part', { shape: ref('lv'), origin: numList([0, 0, 3.2]) })
  g = emit(g, 'rf', 'box', { size: numList([13, 11, 0.3]) })
  g = emit(g, 'p_roof', 'part', { shape: ref('rf'), material: ref('mat'), origin: numList([0, 0, 6.55]) })
  return g
}

/**
 * 角色路场景：手写躯干 + 两个逐件预烘的 `<sha>.obj` mesh 引用（`g_bake_part` 的产物），
 * 靠默认/显式 `include_mesh_parts=true` 合并成一张可蒙皮网格——这才是 include_mesh_parts
 * 默认值真正对应的现实场景（不是 mixedBuilding 那种 .glb storey 引用）。
 */
function characterAssembly(): Geometry {
  let g = makeGeometry()
  g = emit(g, 'torso', 'box', { size: numList([0.3, 0.2, 0.5]) })
  g = emit(g, 'p_torso', 'part', { shape: ref('torso') })
  g = emit(g, 'arm_l', 'mesh', { filename: str('a1b2c3d4e5f60000000000000000000000000000000000000000000000000a.obj') })
  g = emit(g, 'p_arm_l', 'part', { shape: ref('arm_l'), origin: numList([0.2, 0, 0.4]) })
  g = emit(g, 'arm_r', 'mesh', { filename: str('a1b2c3d4e5f60000000000000000000000000000000000000000000000000b.obj') })
  g = emit(g, 'p_arm_r', 'part', { shape: ref('arm_r'), origin: numList([-0.2, 0, 0.4]) })
  return g
}

describe('g_bake_object · include_mesh_parts', () => {
  it('merges pre-baked <sha>.obj mesh-ref parts by default (the character path depends on it)', async () => {
    const baker = fakeBaker()
    const out = await gBakeObject({ geometry: characterAssembly() }, baker.ctx)
    expect(out.error).toBe('')
    expect(baker.calls[0]!.map((p) => p.shapeId)).toEqual(['torso', 'arm_l', 'arm_r'])
    expect(out.filename).toBe('obj3ct.glb')
  })

  it('rejects a non-.obj mesh-ref part even when include_mesh_parts=true (matches the real baker\'s <sha>.obj-only constraint)', async () => {
    const baker = fakeBaker()
    const out = await gBakeObject({ geometry: mixedBuilding(), include_mesh_parts: true }, baker.ctx)
    expect(out.error).toMatch(/only per-part <sha>\.obj/)
    expect(out.error).toMatch(/storey\.glb/)
    expect(out.filename).toBe('')
    expect(baker.calls).toEqual([]) // 应在 baker 之前就挡掉，不应该发出 bake 请求
  })

  it('skips mesh-ref parts when told to, and says how many it left out', async () => {
    const baker = fakeBaker()
    const out = await gBakeObject({ geometry: mixedBuilding(), include_mesh_parts: false }, baker.ctx)
    expect(out.error).toBe('')
    // only the hand-authored real shape goes into the merged GLB
    expect(baker.calls[0]!.map((p) => p.shapeId)).toEqual(['rf'])
    expect(baker.calls[0]![0]!.origin).toEqual([0, 0, 6.55])
    expect(out.note).toMatch(/2 pre-baked mesh parts/)
  })

  it('accepts the switch as a string port value (node editor)', async () => {
    const baker = fakeBaker()
    const out = await gBakeObject({ geometry: mixedBuilding(), include_mesh_parts: 'false' }, baker.ctx)
    expect(out.error).toBe('')
    expect(baker.calls[0]!.map((p) => p.shapeId)).toEqual(['rf'])
  })

  it('refuses instead of baking an empty object when every part is a mesh ref', async () => {
    let g = makeGeometry()
    g = emit(g, 'm', 'mesh', { filename: str('a.obj') })
    g = emit(g, 'p', 'part', { shape: ref('m') })
    const out = await gBakeObject({ geometry: g, include_mesh_parts: false }, fakeBaker().ctx)
    expect(out.error).toMatch(/include_mesh_parts=false/)
    expect(out.filename).toBe('')
  })

  it('still reports a geometry with no parts at all', async () => {
    let g = makeGeometry()
    g = emit(g, 'b', 'box', { size: numList([1, 1, 1]) })
    expect((await gBakeObject({ geometry: g }, fakeBaker().ctx)).error).toMatch(/no part\(\) statements/)
  })

  it('rejects a part whose shape cannot be baked, whatever the switch says', async () => {
    let g = makeGeometry()
    g = emit(g, 'c', 'cylinder', { radius: num(0.2), length: num(1) })
    g = emit(g, 'p_c', 'part', { shape: ref('c') })
    g = emit(g, 'j', 'joint', { type: str('fixed'), parent: ref('p_c'), child: ref('p_c') })
    g = emit(g, 'p_bad', 'part', { shape: ref('j') })
    const out = await gBakeObject({ geometry: g, include_mesh_parts: false }, fakeBaker().ctx)
    expect(out.error).toMatch(/not bakeable/)
  })
})

describe('g_bake_object · parts registry', () => {
  it('registers the merged object in ctx.services.parts (mesh-aware QC needs a real bbox for it)', async () => {
    const baker = fakeBaker()
    const out = await gBakeObject({ geometry: characterAssembly() }, baker.ctx)
    expect(out.error).toBe('')
    expect(baker.registered).toHaveLength(1)
    const entry = baker.registered[0]!
    expect(entry.filename).toBe('obj3ct.glb')
    expect(entry.sha256).toBe('obj3ct')
    expect(entry.bbox_min).toEqual([-1, -1, 0])
    expect(entry.bbox_max).toEqual([1, 1, 2])
    expect(entry.dims).toEqual([2, 2, 2])
    expect(entry.name).toMatch(/^object_/)
  })

  it('does not blow up when ctx.services.parts is unavailable', async () => {
    const baker = fakeBaker()
    // @ts-expect-error — deliberately drop the registry to exercise the optional-chain path
    delete baker.ctx.services.parts
    const out = await gBakeObject({ geometry: characterAssembly() }, baker.ctx)
    expect(out.error).toBe('')
  })
})

describe('g_bake_object · malformed origin/rpy', () => {
  it('errors on a wrong-length origin instead of silently dropping it to identity', async () => {
    let g = makeGeometry()
    g = emit(g, 'b', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p_b', 'part', { shape: ref('b'), origin: numList([1, 2]) }) // missing z
    const out = await gBakeObject({ geometry: g }, fakeBaker().ctx)
    expect(out.error).toMatch(/part "p_b" origin must have exactly 3 numbers, got 2/)
  })

  it('errors on a wrong-length rpy instead of silently dropping it to identity', async () => {
    let g = makeGeometry()
    g = emit(g, 'b', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p_b', 'part', { shape: ref('b'), rpy: numList([0, 0, 0, 0]) }) // one too many
    const out = await gBakeObject({ geometry: g }, fakeBaker().ctx)
    expect(out.error).toMatch(/part "p_b" rpy must have exactly 3 numbers, got 4/)
  })

  it('still allows an absent origin/rpy (defaults apply, no error)', async () => {
    let g = makeGeometry()
    g = emit(g, 'b', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p_b', 'part', { shape: ref('b') })
    const out = await gBakeObject({ geometry: g }, fakeBaker().ctx)
    expect(out.error).toBe('')
  })
})
