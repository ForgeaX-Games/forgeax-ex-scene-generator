import { describe, expect, it } from 'vitest'

import { emit, makeGeometry, num, str, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gBakeAnimation } from '../../batteries/Animation/Clip/g_bake_animation/index.ts'

/** 一个带单个 revolute 关节（限位 [-1, 1] 弧度）的最小 geometry，供 q(t) 校验用。 */
function geometryWithRevoluteJoint(id = 'j1', lower = -1, upper = 1): Geometry {
  return emit(makeGeometry(), id, 'joint', {
    type: str('revolute'),
    lower: num(lower),
    upper: num(upper),
  })
}

describe('g_bake_animation', () => {
  it('samples sparse keyframes into a full per-frame clip and emits q_json', () => {
    const geometry = geometryWithRevoluteJoint()
    const out = gBakeAnimation({
      geometry,
      fps: 10,
      keyframes: JSON.stringify({ j1: [{ t: 0, q: 0 }, { t: 1, q: 0.5 }] }),
    })

    expect(out.error).toBe('')
    const animation = out.animation as { fps: number; frameCount: number; channels: Record<string, number[]> }
    expect(animation.fps).toBe(10)
    // duration auto = max t (1s) @ 10fps -> 11 frames
    expect(animation.frameCount).toBe(11)
    expect(animation.channels.j1).toHaveLength(11)
    expect(animation.channels.j1[0]).toBeCloseTo(0)
    expect(animation.channels.j1[5]).toBeCloseTo(0.25) // halfway, linear interp
    expect(animation.channels.j1[10]).toBeCloseTo(0.5)

    // emitted `animation` statement round-trips through a self-contained q_json arg.
    const geomOut = out.geometry as Geometry
    const stmt = geomOut.statements.find((s) => s.op === 'animation')
    expect(stmt).toBeDefined()
    const q_json = stmt!.args.q_json
    expect(q_json?.kind).toBe('string')
    const reparsed = JSON.parse((q_json as { kind: 'string'; value: string }).value)
    expect(reparsed.channels.j1).toHaveLength(11)
  })

  it('holds the last keyframe value beyond duration and clamps to joint limits', () => {
    const geometry = geometryWithRevoluteJoint('j1', -1, 1)
    const out = gBakeAnimation({
      geometry,
      fps: 10,
      duration: 2,
      keyframes: JSON.stringify({ j1: [{ t: 0, q: 0 }, { t: 1, q: 5 }] }), // 5 rad exceeds upper=1
    })

    expect(out.error).toBe('')
    const animation = out.animation as { channels: Record<string, number[]> }
    expect(animation.channels.j1).toHaveLength(21) // duration=2 @ 10fps -> 21 frames
    expect(animation.channels.j1[10]).toBeCloseTo(1) // clamped to upper limit
    expect(animation.channels.j1[20]).toBeCloseTo(1) // held + clamped past t=1
  })

  it('supports step interpolation (hold previous keyframe value)', () => {
    const geometry = geometryWithRevoluteJoint()
    const out = gBakeAnimation({
      geometry,
      fps: 10,
      interpolation: 'step',
      keyframes: JSON.stringify({ j1: [{ t: 0, q: 0 }, { t: 1, q: 1 }] }),
    })

    const animation = out.animation as { channels: Record<string, number[]> }
    expect(animation.channels.j1[5]).toBe(0) // still holding the first keyframe mid-segment
    expect(animation.channels.j1[10]).toBe(1)
  })

  it('rejects a channel that targets an unknown/non-movable joint', () => {
    const geometry = geometryWithRevoluteJoint('j1')
    const out = gBakeAnimation({
      geometry,
      keyframes: JSON.stringify({ nope: [{ t: 0, q: 0 }, { t: 1, q: 0.5 }] }),
    })
    expect(out.error).toContain('nope')
  })

  it('still accepts a full q_json clip (backward-compatible path)', () => {
    const geometry = geometryWithRevoluteJoint()
    const out = gBakeAnimation({
      geometry,
      q_json: JSON.stringify({ fps: 5, frameCount: 3, channels: { j1: [0, 0.4, 0.8] } }),
    })
    expect(out.error).toBe('')
    const animation = out.animation as { channels: Record<string, number[]> }
    expect(animation.channels.j1).toEqual([0, 0.4, 0.8])
  })

  it('errors when no q(t) source is provided at all', () => {
    const geometry = geometryWithRevoluteJoint()
    const out = gBakeAnimation({ geometry })
    expect(out.error).toContain('no q(t) provided')
  })
})
