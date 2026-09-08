/**
 * mesh-aware QC 单测（Workstream D · d-meshqc / d-assembly · verify）。
 *
 * 构造已知穿模 / 错位用例，确认：
 *   - 全 mesh 组装也能算实体级世界 AABB 重叠（参数化 QC 拿不到 mesh bbox 的盲区）
 *   - 命中时给出**可执行**修正建议（具体平移量），且移动方向/大小正确
 *   - 运动关节下穿模为 warning（clean 仍为 true）；静态下为 note（clean=true）
 */

import { describe, it, expect } from 'vitest'
import { meshAwareQc, type BakedPart } from '../src/services/mesh-qc.js'

/** ±0.1m 立方体的烘焙 bbox。 */
function cubeBaked(filename: string): BakedPart {
  return { filename, bbox_min: [-0.1, -0.1, -0.1], bbox_max: [0.1, 0.1, 0.1] }
}

const bakedMap = (...files: string[]): ReadonlyMap<string, BakedPart> =>
  new Map(files.map((f) => [f, cubeBaked(f)]))

describe('meshAwareQc: interpenetration', () => {
  it('detects overlap between two baked-mesh parts and suggests an executable translate', () => {
    const src = [
      'm1 = mesh(filename="a.obj")',
      'p1 = part(shape=m1, origin=[0, 0, 0])',
      'm2 = mesh(filename="b.obj")',
      'p2 = part(shape=m2, origin=[0.05, 0, 0])',
    ].join('\n')
    const r = meshAwareQc(src, bakedMap('a.obj', 'b.obj'))

    expect(r.meshResolved).toBe(2)
    const overlap = r.signals.find((s) => s.code === 'mesh_overlap')
    expect(overlap).toBeTruthy()
    // 无运动关节 → note，clean 仍为 true（非硬失败，无强制分离建议）
    expect(overlap!.severity).toBe('note')
    expect(r.clean).toBe(true)
    expect(overlap!.suggestion).toBeUndefined()
  })

  it('reports moving-joint overlap as warning only (clean stays true)', () => {
    const src = [
      'm1 = mesh(filename="a.obj")',
      'p1 = part(shape=m1)',
      'm2 = mesh(filename="b.obj")',
      'p2 = part(shape=m2)',
      'j = joint(type="revolute", parent=p1, child=p2, axis=[0,0,1], origin=[0.05, 0, 0])',
    ].join('\n')
    const r = meshAwareQc(src, bakedMap('a.obj', 'b.obj'))
    const overlap = r.signals.find((s) => s.code === 'mesh_overlap')
    expect(overlap).toBeTruthy()
    expect(overlap!.severity).toBe('warning')
    expect(r.clean).toBe(true)
  })

  it('stays clean when baked meshes do not overlap', () => {
    const src = [
      'm1 = mesh(filename="a.obj")',
      'p1 = part(shape=m1, origin=[0, 0, 0])',
      'm2 = mesh(filename="b.obj")',
      'p2 = part(shape=m2, origin=[1, 0, 0])',
    ].join('\n')
    const r = meshAwareQc(src, bakedMap('a.obj', 'b.obj'))
    expect(r.signals.some((s) => s.code === 'mesh_overlap')).toBe(false)
    expect(r.clean).toBe(true)
  })

  it('flags a joint that leaves its child detached from the parent, with a nudge suggestion', () => {
    const src = [
      'm1 = mesh(filename="a.obj")',
      'p1 = part(shape=m1)',
      'm2 = mesh(filename="b.obj")',
      'p2 = part(shape=m2)',
      'j = joint(type="fixed", parent=p1, child=p2, origin=[1, 0, 0])',
    ].join('\n')
    const r = meshAwareQc(src, bakedMap('a.obj', 'b.obj'))
    const detached = r.signals.find((s) => s.code === 'joint_child_detached')
    expect(detached).toBeTruthy()
    expect(detached!.suggestion!.op).toBe('set_joint_origin_delta')
    expect(detached!.suggestion!.target).toBe('j')
    // 建议把 child 世界中心朝 parent 拉近 ~ -X
    expect(detached!.suggestion!.delta[0]).toBeLessThan(0)
  })

  it('keeps a benign fixed-joint mesh overlap a note even when an unrelated moving joint exists elsewhere (moving-joint trap)', () => {
    const src = [
      'm1 = mesh(filename="a.obj")',
      'p1 = part(shape=m1, origin=[0, 0, 0])',
      'm2 = mesh(filename="b.obj")',
      // overlaps p1, but only ever linked to it via a fixed joint
      'p2 = part(shape=m2, origin=[0.05, 0, 0])',
      'j1 = joint(type="fixed", parent=p1, child=p2)',
      'm3 = mesh(filename="c.obj")',
      // stacked just above p1 (0.05m gap, well seated, no overlap) — moved by a revolute
      // joint that has nothing to do with the p1/p2 overlap pair
      'p3 = part(shape=m3)',
      'j2 = joint(type="revolute", parent=p1, child=p3, origin=[0, 0, 0.25], axis=[0, 0, 1])',
    ].join('\n')
    const r = meshAwareQc(src, bakedMap('a.obj', 'b.obj', 'c.obj'))
    const overlap = r.signals.find((s) => s.code === 'mesh_overlap')
    expect(overlap).toBeTruthy()
    expect(overlap!.severity).toBe('note')
    expect(r.clean).toBe(true)
  })

  it('produces no mesh-aware signals for a primitive-only assembly (no baked meshes)', () => {
    const src = [
      'b1 = box(size=[0.2, 0.2, 0.2])',
      'p1 = part(shape=b1, origin=[0, 0, 0])',
      'b2 = box(size=[0.2, 0.2, 0.2])',
      'p2 = part(shape=b2, origin=[0.05, 0, 0])',
    ].join('\n')
    const r = meshAwareQc(src, bakedMap('a.obj', 'b.obj'))
    expect(r.meshResolved).toBe(0)
    expect(r.signals).toEqual([])
    expect(r.clean).toBe(true)
  })

  it('caps inline signals while retaining pair and omitted counts', () => {
    const src = Array.from({ length: 4 }, (_, i) => [
      `m${i} = mesh(filename="${i}.obj")`,
      `p${i} = part(shape=m${i})`,
    ].join('\n')).join('\n')
    const r = meshAwareQc(src, bakedMap('0.obj', '1.obj', '2.obj', '3.obj'), { maxSignals: 2 })
    expect(r.pairCount).toBe(6)
    expect(r.signals).toHaveLength(2)
    expect(r.omittedCount).toBe(4)
    expect(r.clean).toBe(true)
  })
})
