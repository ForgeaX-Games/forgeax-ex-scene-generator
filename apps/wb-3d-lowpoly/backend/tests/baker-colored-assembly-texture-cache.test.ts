/**
 * 回归测试（Finding B P1）：mesh-ref / rock / boulder / sdf_blob / pipe / sweep /
 * section_loft 上的贴图从来不会真正生效（baker.service.ts 的 bakeColoredAssemblyInner
 * 里没有 OCCT face 元数据算不出 UV），但换贴图之前会被计入 bakeColoredAssembly 的缓存
 * 签名——导致强制重烘却画面毫无变化。
 *
 * 这里只单测纯函数 `shapeLosesTextureUv`（不触发真实 OCCT bake，安全、快速），
 * 覆盖：直接命中的无 UV 叶子 op、透传 transform 链、CSG/profile 链上的 UV-able 形状。
 */
import { describe, it, expect } from 'vitest'
import { geometryFromSource, type Statement } from '../../vendor/dist/shared/types/index.js'
import { shapeLosesTextureUv } from '../src/services/baker/baker.service.js'

function byIdFrom(src: string): Map<string, Statement> {
  const geom = geometryFromSource(src)
  return new Map(geom.statements.map((s) => [s.id, s]))
}

describe('shapeLosesTextureUv', () => {
  it('flags a direct mesh-ref part shape (no OCCT face metadata)', () => {
    const byId = byIdFrom(`m1 = mesh(filename="a.obj")`)
    expect(shapeLosesTextureUv('m1', byId)).toBe(true)
  })

  it.each(['rock', 'boulder', 'sdf_blob'])('flags a bare %s leaf', (op) => {
    const byId = byIdFrom(`s1 = ${op}(seed=1)`)
    expect(shapeLosesTextureUv('s1', byId)).toBe(true)
  })

  it.each(['pipe', 'sweep', 'section_loft'])('flags a bare %s leaf', (op) => {
    const byId = byIdFrom(`s1 = ${op}(seed=1)`)
    expect(shapeLosesTextureUv('s1', byId)).toBe(true)
  })

  it('sees through a translate/rotate/scale/mirror/array_* wrapper to the underlying no-UV leaf', () => {
    const byId = byIdFrom(`
      m1 = mesh(filename="a.obj")
      t1 = translate(shape=m1, offset=[1, 0, 0])
      r1 = rotate(shape=t1, axis=[0, 0, 1], angle=90)
    `)
    expect(shapeLosesTextureUv('r1', byId)).toBe(true)
  })

  it('does NOT flag a plain OCCT primitive (box has real face metadata → UV works)', () => {
    const byId = byIdFrom(`b1 = box(size=[1, 1, 1])`)
    expect(shapeLosesTextureUv('b1', byId)).toBe(false)
  })

  it('does NOT flag a transform wrapping a real OCCT primitive', () => {
    const byId = byIdFrom(`
      c1 = cylinder(radius=0.2, length=1)
      t1 = translate(shape=c1, offset=[0, 0, 1])
    `)
    expect(shapeLosesTextureUv('t1', byId)).toBe(false)
  })

  it('does NOT flag a CSG/profile result (union always yields an OCCT solid, never mesh-backed)', () => {
    const byId = byIdFrom(`
      b1 = box(size=[1, 1, 1])
      b2 = box(size=[0.5, 0.5, 0.5])
      u1 = union(shapes=[b1, b2])
    `)
    expect(shapeLosesTextureUv('u1', byId)).toBe(false)
  })

  it('is safe against cyclic refs (defers to real bake-time error, does not infinite-loop)', () => {
    const byId = new Map<string, Statement>()
    byId.set('a', { id: 'a', op: 'translate', args: { shape: { kind: 'ref', name: 'b' } } } as unknown as Statement)
    byId.set('b', { id: 'b', op: 'translate', args: { shape: { kind: 'ref', name: 'a' } } } as unknown as Statement)
    expect(shapeLosesTextureUv('a', byId)).toBe(false)
  })

  it('returns false for an unknown shapeId (missing ref errors elsewhere, not here)', () => {
    const byId = byIdFrom(`b1 = box(size=[1, 1, 1])`)
    expect(shapeLosesTextureUv('does_not_exist', byId)).toBe(false)
  })
})
