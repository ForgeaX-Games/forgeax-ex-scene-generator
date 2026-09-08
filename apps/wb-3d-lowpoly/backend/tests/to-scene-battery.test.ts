/**
 * g_to_scene 单测 —— 重点是损坏的 part→shape 引用要报错，而不是静默从场景里消失
 * （Finding B P2 回归：修复前 `!shapeRef`/`!shape` 都是静默 `continue`，agent 只会
 * 看到 itemCount 少了一个，完全定位不到是哪个 part、为什么）。
 */
import { describe, it, expect } from 'vitest'
import { makeGeometry, emit, numList, ref, str, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gToScene } from '../../batteries/Output/Export/g_to_scene/index.js'

describe('g_to_scene · broken part→shape refs', () => {
  it('errors when a part has no shape ref at all', () => {
    let g = makeGeometry()
    g = emit(g, 'p_bad', 'part', {})
    const out = gToScene({ geometry: g }) as Record<string, unknown>
    expect(out.error).toMatch(/part "p_bad" is missing a shape ref/)
    expect(out.sceneSpec).toBeNull()
  })

  it('errors when a part references a shape id that does not exist in the geometry', () => {
    let g = makeGeometry()
    g = emit(g, 'p_bad', 'part', { shape: ref('does_not_exist') })
    const out = gToScene({ geometry: g }) as Record<string, unknown>
    expect(out.error).toMatch(/part "p_bad" references unknown shape "does_not_exist"/)
    expect(out.sceneSpec).toBeNull()
  })

  it('still assembles a normal mesh-ref scene (no false positives from the new checks)', () => {
    let g: Geometry = makeGeometry()
    g = emit(g, 'm1', 'mesh', { filename: str('a1b2c3.obj') })
    g = emit(g, 'p1', 'part', { shape: ref('m1'), origin: numList([1, 0, 0]) })
    const out = gToScene({ geometry: g }) as Record<string, unknown>
    expect(out.error).toBe('')
    expect((out.sceneSpec as { itemCount: number }).itemCount).toBe(1)
  })

  it('still skips (not errors) a real-shape part — that path is handled by g_bake_object, not here', () => {
    let g: Geometry = makeGeometry()
    g = emit(g, 'b1', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p1', 'part', { shape: ref('b1') })
    g = emit(g, 'm1', 'mesh', { filename: str('a1b2c3.obj') })
    g = emit(g, 'p2', 'part', { shape: ref('m1') })
    const out = gToScene({ geometry: g }) as Record<string, unknown>
    expect(out.error).toBe('')
    expect((out.sceneSpec as { itemCount: number }).itemCount).toBe(1)
  })
})
