/**
 * g_storey_stack 电池单测：把建好的一层整体沿 Z 复制成多层。
 *
 * 覆盖两种模式：
 *   - merge（默认）：整层烘成单个多材质 GLB，每层只剩 1 个 part —— 这里用一个假 baker
 *     断言"交给烘焙的位姿已经沿层内 joint 展平"，以及原始层的 part/joint 确实被顶替掉了。
 *   - instance：逐层复制 part/joint，副本共享同一批 shape 语句（不重烘）。
 * 外加关节路 / 静态路、root 推断、层间连接、错误兜底。
 */
import { describe, it, expect } from 'vitest'
import { makeGeometry, emit, num, numList, ref, str, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gStoreyStack } from '../../batteries/Generate/Architecture/g_storey_stack/index.js'
import { gGeometryQc } from '../../batteries/Output/QC/g_geometry_qc/index.js'

/** 一层：楼板 + 两片墙 + 一根柱，墙/柱以 fixed joint 挂在楼板上。 */
function typicalStorey(opts: { jointed: boolean }): Geometry {
  let g = makeGeometry()
  g = emit(g, 'mat', 'material', { rgba: numList([0.8, 0.8, 0.78, 1]) })
  g = emit(g, 'slab', 'floor_slab', { size: numList([12, 10]), thickness: num(0.2) })
  g = emit(g, 'w', 'wall', { length: num(12), height: num(3.2), thickness: num(0.2) })
  g = emit(g, 'col', 'column', { height: num(3.2), radius: num(0.25) })
  g = emit(g, 'p_slab', 'part', { shape: ref('slab'), material: ref('mat') })
  g = emit(g, 'p_w1', 'part', { shape: ref('w'), material: ref('mat') })
  g = emit(g, 'p_w2', 'part', { shape: ref('w'), material: ref('mat') })
  g = emit(g, 'p_col', 'part', { shape: ref('col'), material: ref('mat'), origin: numList([1, 2, 0]) })
  if (opts.jointed) {
    g = emit(g, 'j_w1', 'joint', { type: str('fixed'), parent: ref('p_slab'), child: ref('p_w1'), origin: numList([0, -5, 0.2]) })
    g = emit(g, 'j_w2', 'joint', { type: str('fixed'), parent: ref('p_slab'), child: ref('p_w2'), origin: numList([0, 5, 0.2]), rpy: numList([0, 0, Math.PI / 2]) })
    g = emit(g, 'j_col', 'joint', { type: str('fixed'), parent: ref('p_slab'), child: ref('p_col'), origin: numList([3, 0, 0.2]) })
  }
  return g
}

const STOREY_PARTS = ['p_slab', 'p_w1', 'p_w2', 'p_col']

interface AssemblyPart {
  shapeId: string
  rgba: [number, number, number, number]
  origin?: [number, number, number]
  rpy?: [number, number, number]
}

/** 假 baker：不跑 OCCT，只记录送进烘焙的 part 列表，并回一个固定的 <sha>.glb。 */
function fakeBaker() {
  const calls: AssemblyPart[][] = []
  return {
    calls,
    ctx: {
      services: {
        baker: {
          async bakeColoredAssembly(parts: readonly AssemblyPart[]) {
            calls.push(parts.map((p) => ({ ...p })))
            return {
              url: 'st0rey.glb',
              sha256: 'st0rey',
              vertexCount: 240,
              triangleCount: 120,
              cacheHit: false,
              bboxMin: [-6, -5, 0] as [number, number, number],
              bboxMax: [6, 5, 3.4] as [number, number, number],
            }
          },
        },
      },
    },
  }
}

const near = (v: readonly number[] | undefined, expected: readonly number[]) => {
  expect(v).toBeDefined()
  for (let i = 0; i < expected.length; i++) expect(v![i]).toBeCloseTo(expected[i]!, 9)
}

describe('g_storey_stack · mode="merge" (default)', () => {
  it('bakes the storey into one GLB and leaves exactly one part per storey', async () => {
    const baker = fakeBaker()
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      root_id: 'p_slab',
      count: 20,
      storey_height: 3.2,
      prefix: 'lv',
    }, baker.ctx)
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry

    // 20 storeys cost 20 parts, not 20 × 4. This is the whole point of merge mode.
    const parts = geom.statements.filter((s) => s.op === 'part')
    expect(parts).toHaveLength(20)
    expect(parts.map((p) => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => `lv_l${i + 1}`))

    // The authored storey's parts and its intra-storey joints are gone — replaced.
    for (const id of [...STOREY_PARTS, 'j_w1', 'j_w2', 'j_col']) {
      expect(geom.statements.some((s) => s.id === id)).toBe(false)
    }

    // One mesh statement, shared by every storey: a single copy of the geometry.
    expect(geom.statements.filter((s) => s.op === 'mesh')).toHaveLength(1)
    const mesh = geom.statements.find((s) => s.id === 'lv_mesh')!
    expect(mesh.args.filename).toEqual(str('st0rey.glb'))
    expect(mesh.args.bbox_min).toEqual(numList([-6, -5, 0]))
    expect(mesh.args.bbox_max).toEqual(numList([6, 5, 3.4]))
    // No material on the storey parts: a link material would override the colours
    // baked into the GLB.
    expect(parts.every((p) => p.args.material === undefined)).toBe(true)
    expect(parts.map((p) => p.args.shape)).toEqual(parts.map(() => ref('lv_mesh')))

    // Storeys are chained root-to-root, one storey height apart.
    const link = geom.statements.find((s) => s.id === 'lv_j7')!
    expect(link.args.parent).toEqual(ref('lv_l6'))
    expect(link.args.child).toEqual(ref('lv_l7'))
    expect(link.args.origin).toEqual(numList([0, 0, 3.2]))

    expect(out.id).toBe('lv_l20')
    expect(out.filename).toBe('st0rey.glb')
    expect(out.triangle_count).toBe(120)
    expect(JSON.parse(out.level_roots as string)).toHaveLength(20)
    expect(baker.calls).toHaveLength(1) // one bake for the whole tower
  })

  it('flattens intra-storey joint poses into the baked assembly', async () => {
    const baker = fakeBaker()
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      count: 3,
      storey_height: 3.2,
    }, baker.ctx)
    expect(out.error).toBe('')

    const baked = baker.calls[0]!
    expect(baked.map((p) => p.shapeId)).toEqual(['slab', 'w', 'w', 'col'])
    // Root sits at the storey origin.
    near(baked[0]!.origin, [0, 0, 0])
    // p_w1 has no part origin, so its pose is purely the joint's.
    near(baked[1]!.origin, [0, -5, 0.2])
    // p_w2's joint carries a yaw, which must survive the flattening.
    near(baked[2]!.rpy, [0, 0, Math.PI / 2])
    // p_col composes joint origin [3,0,0.2] with its own part origin [1,2,0].
    near(baked[3]!.origin, [4, 2, 0.2])
    // Colours come from each part's material, so the GLB stays multi-material.
    expect(baked[0]!.rgba).toEqual([0.8, 0.8, 0.78, 1])
  })

  it('drops the storey shapes it swallowed, but keeps ones still used elsewhere', async () => {
    let g = typicalStorey({ jointed: true })
    // A porch reusing the same wall shape, hung off the storey root.
    g = emit(g, 'p_porch', 'part', { shape: ref('w'), material: ref('mat') })
    g = emit(g, 'j_porch', 'joint', { type: str('fixed'), parent: ref('p_slab'), child: ref('p_porch'), origin: numList([6, 0, 0.2]) })

    const out = await gStoreyStack({ geometry: g, part_ids: STOREY_PARTS, count: 4, storey_height: 3.2 }, fakeBaker().ctx)
    expect(out.error).toBe('')
    const ids = (out.geometry as Geometry).statements.map((s) => s.id)
    // g_to_urdf bakes every top-level composite shape it finds, so leaving the
    // swallowed ones behind would re-bake the whole storey on every apply.
    expect(ids).not.toContain('slab')
    expect(ids).not.toContain('col')
    // ...but the wall and the material are still referenced by the porch.
    expect(ids).toContain('w')
    expect(ids).toContain('mat')
  })

  it('re-parents an external joint that hung off the storey root', async () => {
    let g = typicalStorey({ jointed: true })
    g = emit(g, 'gb', 'box', { size: numList([14, 12, 0.4]) })
    g = emit(g, 'p_ground', 'part', { shape: ref('gb') })
    g = emit(g, 'j_ground', 'joint', { type: str('fixed'), parent: ref('p_ground'), child: ref('p_slab'), origin: numList([0, 0, 0.4]) })

    const out = await gStoreyStack({ geometry: g, part_ids: STOREY_PARTS, count: 4, storey_height: 3.2 }, fakeBaker().ctx)
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    const j = geom.statements.find((s) => s.id === 'j_ground')!
    expect(j.args.child).toEqual(ref('lv_l1'))
    expect(j.args.origin).toEqual(numList([0, 0, 0.4])) // GLB frame == storey root frame
    // The re-parented joint still comes after the part it now references.
    const idx = (id: string) => geom.statements.findIndex((s) => s.id === id)
    expect(idx('lv_l1')).toBeLessThan(idx('j_ground'))

    const qc = gGeometryQc({ geometry: geom })
    expect(qc.islands).toBe(1)
    expect(qc.floating_links).toBe(0)
  })

  it('refuses to swallow a part that something outside the storey is attached to', async () => {
    let g = typicalStorey({ jointed: true })
    g = emit(g, 'ab', 'box', { size: numList([2, 1, 1]) })
    g = emit(g, 'p_awning', 'part', { shape: ref('ab') })
    g = emit(g, 'j_awning', 'joint', { type: str('fixed'), parent: ref('p_w1'), child: ref('p_awning') })

    const out = await gStoreyStack({ geometry: g, part_ids: STOREY_PARTS, count: 4, storey_height: 3.2 }, fakeBaker().ctx)
    expect(out.error).toMatch(/p_w1/)
    expect(out.error).toMatch(/mode="instance"/)
  })

  it('lifts each storey by its own origin on the jointless static path', async () => {
    const baker = fakeBaker()
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: false }),
      part_ids: STOREY_PARTS,
      count: 3,
      storey_height: 3.2,
    }, baker.ctx)
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    expect(geom.statements.some((s) => s.op === 'joint')).toBe(false)
    expect(geom.statements.find((s) => s.id === 'lv_l1')!.args.origin).toBeUndefined()
    expect(geom.statements.find((s) => s.id === 'lv_l3')!.args.origin).toEqual(numList([0, 0, 6.4]))
    // With no joints the parts keep their authored origins inside the baked GLB.
    near(baker.calls[0]![3]!.origin, [1, 2, 0])
  })

  it('lets merged storeys coexist with hand-authored real-shape parts on the static path', async () => {
    // The scene exporter partitions these: mesh-reference storeys become their own
    // SceneSpec items, the roof goes through the whole-model bake. Neither is dropped,
    // so merge mode no longer has to refuse the mix.
    let g = typicalStorey({ jointed: false })
    g = emit(g, 'r', 'roof', { width: num(12), depth: num(10), type: str('flat'), height: num(0.4) })
    g = emit(g, 'p_roof', 'part', { shape: ref('r'), material: ref('mat'), origin: numList([0, 0, 9.6]) })

    const out = await gStoreyStack({ geometry: g, part_ids: STOREY_PARTS, count: 3, storey_height: 3.2 }, fakeBaker().ctx)
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    // the roof survives untouched next to the three merged storey parts
    const roof = geom.statements.find((s) => s.id === 'p_roof')!
    expect(roof.args.shape).toEqual(ref('r'))
    expect(roof.args.origin).toEqual(numList([0, 0, 9.6]))
    expect(geom.statements.filter((s) => s.op === 'part').map((s) => s.id)).toEqual(['lv_l1', 'lv_l2', 'lv_l3', 'p_roof'])
    expect(geom.statements.some((s) => s.op === 'joint')).toBe(false)
  })

  it('says so when no baker is wired up', async () => {
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      count: 3,
      storey_height: 3.2,
    })
    expect(out.error).toMatch(/bakeColoredAssembly/)
  })
})

describe('g_storey_stack · mode="instance"', () => {
  it('copies every part and joint, reusing the same shape statements', async () => {
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      root_id: 'p_slab',
      mode: 'instance',
      count: 4,
      storey_height: 3.2,
      prefix: 'lv',
    })
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry

    // 3 copies × 4 parts, on top of the 4 original parts
    const parts = geom.statements.filter((s) => s.op === 'part')
    expect(parts).toHaveLength(4 + 3 * 4)
    expect(parts.map((p) => p.id)).toContain('lv_l2_p_slab')
    expect(parts.map((p) => p.id)).toContain('lv_l4_p_col')

    // Copies reuse the ORIGINAL shape/material statements — one baked mesh per
    // element, shared by every storey.
    const copy = parts.find((p) => p.id === 'lv_l3_p_w1')!
    expect(copy.args.shape).toEqual(ref('w'))
    expect(copy.args.material).toEqual(ref('mat'))
    expect(geom.statements.filter((s) => s.op === 'wall')).toHaveLength(1)

    // Intra-storey joints are copied with parent/child remapped into the same level.
    const j = geom.statements.find((s) => s.id === 'lv_l2_j_col')!
    expect(j.args.parent).toEqual(ref('lv_l2_p_slab'))
    expect(j.args.child).toEqual(ref('lv_l2_p_col'))
    expect(j.args.origin).toEqual(numList([3, 0, 0.2]))

    // Consecutive storeys are linked root-to-root, one storey height apart.
    const link2 = geom.statements.find((s) => s.id === 'lv_j2')!
    expect(link2.args.parent).toEqual(ref('p_slab'))
    expect(link2.args.child).toEqual(ref('lv_l2_p_slab'))
    expect(link2.args.origin).toEqual(numList([0, 0, 3.2]))

    expect(out.id).toBe('lv_l4_p_slab')
    expect(out.filename).toBe('')
    expect(JSON.parse(out.level_roots as string)).toEqual(['p_slab', 'lv_l2_p_slab', 'lv_l3_p_slab', 'lv_l4_p_slab'])
  })

  it('keeps the stacked building one rooted tree (no islands / floating links)', async () => {
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      mode: 'instance',
      count: 5,
      storey_height: 3.2,
    })
    const qc = gGeometryQc({ geometry: out.geometry })
    expect(qc.islands).toBe(1) // exactly one connected component = one rooted URDF tree
    expect(qc.floating_links).toBe(0)
  })

  it('lifts copies by their own origin on the jointless static path', async () => {
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: false }),
      part_ids: STOREY_PARTS,
      mode: 'instance',
      count: 3,
      storey_height: 3.2,
      prefix: 'lv',
    })
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    expect(geom.statements.some((s) => s.op === 'joint')).toBe(false)
    expect(geom.statements.find((s) => s.id === 'lv_l2_p_slab')!.args.origin).toEqual(numList([0, 0, 3.2]))
    // an existing part origin is preserved and only shifted in Z
    expect(geom.statements.find((s) => s.id === 'lv_l3_p_col')!.args.origin).toEqual(numList([1, 2, 6.4]))
  })

  it('needs no baker at all', async () => {
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      mode: 'instance',
      count: 3,
      storey_height: 3.2,
    })
    expect(out.error).toBe('')
  })
})

describe('g_storey_stack · shared validation', () => {
  const ctx = fakeBaker().ctx

  it('infers root as the part that is not a joint child, and honours explicit levels', async () => {
    const out = await gStoreyStack({
      geometry: typicalStorey({ jointed: true }),
      part_ids: STOREY_PARTS,
      levels: [3.2, 6.4, 11.0],
    }, ctx)
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    expect(out.id).toBe('lv_l4')
    // level 4 sits 11.0 - 6.4 = 4.6 m above level 3 (a taller mechanical floor)
    expect(geom.statements.find((s) => s.id === 'lv_j4')!.args.origin).toEqual(numList([0, 0, 4.6]))
  })

  it('rejects malformed input instead of emitting a broken storey', async () => {
    const g = typicalStorey({ jointed: true })
    const run = (extra: Record<string, unknown>) => gStoreyStack({ geometry: g, count: 3, storey_height: 3, ...extra }, ctx)
    expect((await run({})).error).toMatch(/parts/)
    expect((await run({ part_ids: ['nope'] })).error).toMatch(/undefined id/)
    expect((await run({ part_ids: ['slab'] })).error).toMatch(/op "floor_slab"/)
    expect((await run({ part_ids: STOREY_PARTS, count: 1 })).error).toMatch(/count/)
    expect((await run({ part_ids: STOREY_PARTS, storey_height: 0 })).error).toMatch(/storey_height/)
    expect((await run({ part_ids: STOREY_PARTS, root_id: 'p_ghost' })).error).toMatch(/root/)
    expect((await run({ part_ids: ['p_slab', 'p_w1', 'p_slab'] })).error).toMatch(/more than once/)
    expect((await run({ part_ids: STOREY_PARTS, mode: 'clone' })).error).toMatch(/mode/)
  })

  it('refuses a storey whose parts are not one subtree under root', async () => {
    let g = makeGeometry()
    g = emit(g, 'b', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p_a', 'part', { shape: ref('b') })
    g = emit(g, 'p_b', 'part', { shape: ref('b') })
    g = emit(g, 'j', 'joint', { type: str('fixed'), parent: ref('p_a'), child: ref('p_b') })
    g = emit(g, 'p_loose', 'part', { shape: ref('b') })
    const out = await gStoreyStack({ geometry: g, part_ids: ['p_a', 'p_b', 'p_loose'], count: 2, storey_height: 3 }, ctx)
    expect(out.error).toMatch(/p_loose/)
  })

  it('accepts part ids as JSON text or a comma-separated list (node editor ports)', async () => {
    const g = typicalStorey({ jointed: true })
    expect((await gStoreyStack({ geometry: g, part_ids: JSON.stringify(STOREY_PARTS), count: 2, storey_height: 3 }, ctx)).error).toBe('')
    expect((await gStoreyStack({ geometry: g, part_ids: STOREY_PARTS.join(', '), count: 2, storey_height: 3 }, ctx)).error).toBe('')
  })
})
