/**
 * g_place_local 电池单测：把"相对父件的局部位姿"在编译期展平成 child 的绝对 origin/rpy。
 *
 * 这条 op 的全部价值在于它跟 joint 树的正向运动学**逐字同一个公式**，只是结果落在 part 上
 * 而不是留到运行时——所以测试的重点是：父件带 yaw 时偏移要跟着转、链式（门框→门扇）第二跳
 * 读到的是第一跳算完的世界位姿、rpy 复合不丢。外加宽容解析与错误兜底。
 */
import { describe, it, expect } from 'vitest'
import { makeGeometry, emit, num, numList, ref, str, type Geometry, type Statement } from '../../vendor/dist/shared/types/index.js'
import { gPlaceLocal } from '../../batteries/Modify/Placement/g_place_local/index.js'

const HALF_PI = Math.PI / 2

/** 一片南墙（无旋转）+ 一片东墙（yaw 90°）+ 一扇窗、一副门框、一扇门。 */
function building(): Geometry {
  let g = makeGeometry()
  g = emit(g, 'w_s', 'wall', { length: num(9), height: num(3), thickness: num(0.25) })
  g = emit(g, 'w_e', 'wall', { length: num(7), height: num(3), thickness: num(0.25) })
  g = emit(g, 'win', 'window', { size: numList([1.2, 1.4]), depth: num(0.25) })
  g = emit(g, 'dfr', 'door_frame', { size: numList([1, 2.1]), depth: num(0.25) })
  g = emit(g, 'dlf', 'door_leaf', { size: numList([0.94, 2.04]), thickness: num(0.05) })
  g = emit(g, 'p_w_s', 'part', { shape: ref('w_s'), origin: numList([0, -4.4, 1.5]) })
  g = emit(g, 'p_w_e', 'part', { shape: ref('w_e'), origin: numList([4.4, 0, 1.5]), rpy: numList([0, 0, HALF_PI]) })
  g = emit(g, 'p_win', 'part', { shape: ref('win') })
  g = emit(g, 'p_dfr', 'part', { shape: ref('dfr') })
  g = emit(g, 'p_dlf', 'part', { shape: ref('dlf') })
  return g
}

const partById = (g: Geometry, id: string): Statement => g.statements.find((s) => s.id === id)!

const near = (a: unknown, expected: readonly number[]): void => {
  const v = a as { kind: string; items: { value: number }[] }
  expect(v?.kind).toBe('list')
  expect(v.items).toHaveLength(expected.length)
  expected.forEach((e, i) => expect(v.items[i]!.value).toBeCloseTo(e, 9))
}

describe('g_place_local', () => {
  it('places a window into an unrotated wall by plain addition', () => {
    const out = gPlaceLocal({
      geometry: building(),
      parent_id: 'p_w_s',
      child_id: 'p_win',
      ox: -2.5,
      oz: 0.6,
    })
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    // parent origin [0,-4.4,1.5] + offset [-2.5,0,0.6]
    near(partById(geom, 'p_win').args.origin, [-2.5, -4.4, 2.1])
    near(partById(geom, 'p_win').args.rpy, [0, 0, 0])
    expect(out.origin).toEqual([-2.5, -4.4, 2.1])
    // the parent is left exactly as authored
    near(partById(geom, 'p_w_s').args.origin, [0, -4.4, 1.5])
  })

  it('rotates the offset into a yaw-90° parent (the whole point of the op)', () => {
    const out = gPlaceLocal({
      geometry: building(),
      parent_id: 'p_w_e',
      child_id: 'p_win',
      ox: 2,
      oz: 0.6,
    })
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    // R(yaw=90°)·[2,0,0.6] = [0,2,0.6], added to the wall origin [4.4,0,1.5]
    near(partById(geom, 'p_win').args.origin, [4.4, 2, 2.1])
    // the child inherits the wall's own yaw so it lies in the wall plane
    near(partById(geom, 'p_win').args.rpy, [0, 0, HALF_PI])
  })

  it('composes the child rpy on top of the parent rotation', () => {
    const out = gPlaceLocal({
      geometry: building(),
      parent_id: 'p_w_e',
      child_id: 'p_win',
      rr: 0,
      rp: 0,
      ry: HALF_PI,
    })
    expect(out.error).toBe('')
    // yaw 90° ∘ yaw 90° = yaw 180°
    near(partById(out.geometry as Geometry, 'p_win').args.rpy, [0, 0, Math.PI])
    expect((out.rpy as number[])[2]).toBeCloseTo(Math.PI, 9)
  })

  it('chains: the door frame goes on the wall, then the leaf onto the frame', () => {
    // The second hop reads the frame's ALREADY-composed world pose — that is what
    // makes chaining work without any tree bookkeeping (DSL is SSA, forward-visible).
    const first = gPlaceLocal({ geometry: building(), parent_id: 'p_w_e', child_id: 'p_dfr', ox: -1.5, oz: -0.45 })
    expect(first.error).toBe('')
    const second = gPlaceLocal({ geometry: first.geometry, parent_id: 'p_dfr', child_id: 'p_dlf', oy: 0.06 })
    expect(second.error).toBe('')

    const geom = second.geometry as Geometry
    // frame: [4.4,0,1.5] + R(90°)·[-1.5,0,-0.45] = [4.4,-1.5,1.05]
    near(partById(geom, 'p_dfr').args.origin, [4.4, -1.5, 1.05])
    // leaf: frame origin + R(90°)·[0,0.06,0] = [4.4-0.06, -1.5, 1.05]
    near(partById(geom, 'p_dlf').args.origin, [4.34, -1.5, 1.05])
    near(partById(geom, 'p_dlf').args.rpy, [0, 0, HALF_PI])
  })

  it('auto-wraps a bare shape id into a part (same leniency as the other placement ops)', () => {
    let g = makeGeometry()
    g = emit(g, 'b', 'box', { size: numList([2, 2, 1]) })
    g = emit(g, 'p_b', 'part', { shape: ref('b'), origin: numList([0, 0, 5]) })
    g = emit(g, 'c', 'cylinder', { radius: num(0.1), length: num(0.4) })

    const out = gPlaceLocal({ geometry: g, parent_id: 'p_b', child_id: 'c', oz: 0.7 })
    expect(out.error).toBe('')
    const geom = out.geometry as Geometry
    const wrapped = geom.statements.find((s) => s.op === 'part' && s.args.shape?.kind === 'ref' && s.args.shape.name === 'c')!
    expect(wrapped).toBeDefined()
    near(wrapped.args.origin, [0, 0, 5.7])
  })

  it('notes (but does not fail) when the same geometry also has joints', () => {
    let g = building()
    g = emit(g, 'j', 'joint', { type: str('fixed'), parent: ref('p_w_s'), child: ref('p_w_e') })
    const out = gPlaceLocal({ geometry: g, parent_id: 'p_w_s', child_id: 'p_win', ox: 1 })
    expect(out.error).toBe('')
    expect(out.note).toMatch(/joint/)
    expect(out.note).toMatch(/URDF path/)
    // still placed
    near(partById(out.geometry as Geometry, 'p_win').args.origin, [1, -4.4, 1.5])
  })

  it('reports missing pieces and bad arguments instead of silently placing at the origin', () => {
    const g = building()
    expect(gPlaceLocal({ parent_id: 'p_w_s', child_id: 'p_win' }).error).toMatch(/geometry/)
    expect(gPlaceLocal({ geometry: g, child_id: 'p_win' }).error).toMatch(/parent_id is required/)
    expect(gPlaceLocal({ geometry: g, parent_id: 'p_w_s' }).error).toMatch(/child_id is required/)
    expect(gPlaceLocal({ geometry: g, parent_id: 'p_ghost', child_id: 'p_win' }).error).toMatch(/not in geometry/)
    expect(gPlaceLocal({ geometry: g, parent_id: 'p_w_s', child_id: 'p_ghost' }).error).toMatch(/not in geometry/)
    expect(gPlaceLocal({ geometry: g, parent_id: 'p_w_s', child_id: 'p_w_s' }).error).toMatch(/on itself/)
    expect(gPlaceLocal({ geometry: g, parent_id: 'p_w_s', child_id: 'p_win', ox: 'nope' }).error).toMatch(/ox \/ oy \/ oz/)
    expect(gPlaceLocal({ geometry: g, parent_id: 'p_w_s', child_id: 'p_win', ry: NaN }).error).toMatch(/rr \/ rp \/ ry/)
    // a failed placement still passes the geometry through untouched
    const failed = gPlaceLocal({ geometry: g, parent_id: 'p_w_s', child_id: 'p_ghost' })
    expect(partById(failed.geometry as Geometry, 'p_win').args.origin).toBeUndefined()
  })
})
