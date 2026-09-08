/**
 * g_bone_chain 电池单测：origin→tail 等分展开成 count 条首尾相接的标准 bone。
 */
import { describe, it, expect } from 'vitest'
import { makeGeometry, emit, ref, str, numList, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gBoneChain } from '../../batteries/Assemble/Rig/g_bone_chain/index.js'
import { gSkinQc } from '../../batteries/Output/QC/g_skin_qc/index.js'

describe('g_bone_chain battery', () => {
  it('expands into `count` standard bone statements, parented in a chain', () => {
    const out = gBoneChain({
      geometry: makeGeometry(),
      id: 'b_tail',
      hx: 0, hy: 0, hz: -0.15,
      tx: 0, ty: 0, tz: -0.65,
      count: 4,
      ax: 0, ay: 1, az: 0,
      parent_id: 'b_spine',
      source_part_id: 'p_tail',
    })
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    const bones = geom.statements.filter((s) => s.op === 'bone')
    expect(bones).toHaveLength(4)
    expect(bones.map((b) => b.id)).toEqual(['b_tail_0', 'b_tail_1', 'b_tail_2', 'b_tail_3'])

    // linear interpolation between head and tail, 4 equal segments
    expect(bones[0]!.args.origin).toEqual(numList([0, 0, -0.15]))
    expect(bones[0]!.args.tail).toEqual(numList([0, 0, -0.275]))
    expect(bones[3]!.args.origin).toEqual(numList([0, 0, -0.525]))
    expect(bones[3]!.args.tail).toEqual(numList([0, 0, -0.65]))

    // first segment parents to the user-supplied parent; the rest chain to the previous segment
    expect(bones[0]!.args.parent).toEqual(ref('b_spine'))
    expect(bones[1]!.args.parent).toEqual(ref('b_tail_0'))
    expect(bones[2]!.args.parent).toEqual(ref('b_tail_1'))
    expect(bones[3]!.args.parent).toEqual(ref('b_tail_2'))

    // axis/source_part applied to every segment
    for (const b of bones) {
      expect(b.args.axis).toEqual(numList([0, 1, 0]))
      expect(b.args.source_part).toEqual(ref('p_tail'))
    }

    // the battery's own output id points at the chain tip (last segment)
    expect(out.id).toBe('b_tail_3')
  })

  it('defaults to no parent on the first segment when parent_id is omitted (root chain)', () => {
    const out = gBoneChain({ geometry: makeGeometry(), id: 'b_snake', hx: 0, hy: 0, hz: 0, tx: 1, ty: 0, tz: 0, count: 3 })
    const geom = out.geometry as Geometry
    const bones = geom.statements.filter((s) => s.op === 'bone')
    expect(bones[0]!.args.parent).toBeUndefined()
    expect(bones[1]!.args.parent).toEqual(ref('b_snake_0'))
    expect(bones[2]!.args.parent).toEqual(ref('b_snake_1'))
  })

  it('rejects count < 1 and missing origin/tail', () => {
    expect(gBoneChain({ geometry: makeGeometry(), count: 0, hx: 0, hy: 0, hz: 0, tx: 1, ty: 0, tz: 0 }).error).toMatch(/count/)
    expect(gBoneChain({ geometry: makeGeometry(), count: 3, tx: 1, ty: 0, tz: 0 }).error).toMatch(/origin/)
    expect(gBoneChain({ geometry: makeGeometry(), count: 3, hx: 0, hy: 0, hz: 0 }).error).toMatch(/tail/)
  })

  it('a bone_chain-expanded rig passes g_skin_qc like a hand-written chain would', () => {
    let g = makeGeometry()
    g = emit(g, 'body', 'box', { size: numList([0.2, 0.2, 0.8]) })
    g = emit(g, 'p_body', 'part', { shape: ref('body') })
    const body = gBoneChain({ geometry: g, id: 'b_spine', hx: 0, hy: 0, hz: 0, tx: 0, ty: 0, tz: 0.3, count: 1 })
    g = body.geometry as Geometry
    const tail = gBoneChain({
      geometry: g, id: 'b_tail', hx: 0, hy: 0, hz: -0.15, tx: 0, ty: 0, tz: -0.65, count: 4,
      parent_id: body.id as string,
    })
    g = tail.geometry as Geometry
    // wire a minimal skeleton/skin so skin_qc has something to validate.
    const finalGeom = {
      ...g,
      statements: Object.freeze([
        ...g.statements,
        { id: 'sk', op: 'skeleton', args: { root: ref(body.id as string) }, line: 0 },
        { id: 'skn', op: 'skin', args: { skeleton: ref('sk'), method: str('auto') }, line: 0 },
      ]),
    } as Geometry
    const qc = gSkinQc({ geometry: finalGeom })
    expect(qc.valid).toBe(true)
    expect(qc.bones).toBe(5) // 1 spine segment + 4 tail segments
  })
})
