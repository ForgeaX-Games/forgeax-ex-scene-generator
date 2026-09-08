/**
 * rock/boulder primitive 单测：icosphere 细分 + 确定性顶点位移（backend/src/services/baker/ops/rock.ts）。
 */
import { describe, it, expect } from 'vitest'
import { rock, boulder } from '../src/services/baker/ops/rock.js'
import { BakerError } from '../src/services/baker/errors.js'
import type { Arg } from '../src/services/baker/shared-types.js'

type Vec3 = readonly [number, number, number]

function num(v: number): Arg { return { kind: 'number', value: v } }
function numList(vs: number[]): Arg { return { kind: 'list', items: vs.map(num) } }

function callRock(args: Record<string, Arg>) {
  return rock(undefined, args)
}

function faceNormal(vertices: readonly Vec3[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]]!, b = vertices[face[1]]!, c = vertices[face[2]]!
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
}
function faceCenter(vertices: readonly Vec3[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]]!, b = vertices[face[1]]!, c = vertices[face[2]]!
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

describe('rock primitive (icosphere + deterministic displacement)', () => {
  it('produces the expected icosphere vertex/face counts per detail level', () => {
    // detail=0: base icosahedron (12 verts / 20 faces); each subdivision: F*=4, and new
    // vertex count follows Euler's formula for a closed triangulated sphere (V=F/2+2).
    const d0 = callRock({ radius: num(1), detail: num(0), irregularity: num(0) })
    expect(d0.faces).toHaveLength(20)
    expect(d0.vertices).toHaveLength(12)

    const d1 = callRock({ radius: num(1), detail: num(1), irregularity: num(0) })
    expect(d1.faces).toHaveLength(80)
    expect(d1.vertices).toHaveLength(42)

    const d2 = callRock({ radius: num(1), detail: num(2), irregularity: num(0) })
    expect(d2.faces).toHaveLength(320)
    expect(d2.vertices).toHaveLength(162)
  })

  it('with irregularity=0 every vertex lands exactly on the sphere of the given radius', () => {
    const radius = 0.42
    const out = callRock({ radius: num(radius), detail: num(1), irregularity: num(0) })
    for (const v of out.vertices) {
      const len = Math.hypot(v[0], v[1], v[2])
      expect(len).toBeCloseTo(radius, 10)
    }
  })

  it('with irregularity=0 all faces wind outward (sanity check on icosahedron/subdivision winding)', () => {
    const out = callRock({ radius: num(1), detail: num(1), irregularity: num(0) })
    for (const face of out.faces) {
      const normal = faceNormal(out.vertices, face)
      const center = faceCenter(out.vertices, face)
      // sphere is centered at the origin, so the outward reference direction is just `center`.
      expect(dot(normal, center)).toBeGreaterThan(0)
    }
  })

  it('irregularity>0 keeps every vertex within [radius*(1-irregularity), radius*(1+irregularity)]', () => {
    const radius = 0.5
    const irregularity = 0.4
    const out = callRock({ radius: num(radius), detail: num(1), irregularity: num(irregularity), seed: num(7) })
    for (const v of out.vertices) {
      const len = Math.hypot(v[0], v[1], v[2])
      expect(len).toBeGreaterThanOrEqual(radius * (1 - irregularity) - 1e-9)
      expect(len).toBeLessThanOrEqual(radius * (1 + irregularity) + 1e-9)
    }
  })

  it('is deterministic: identical args (incl. seed) always produce the identical mesh', () => {
    const args = { radius: num(0.3), irregularity: num(0.35), seed: num(42), detail: num(1) }
    const a = callRock(args)
    const b = callRock(args)
    expect(a.vertices).toEqual(b.vertices)
    expect(a.faces).toEqual(b.faces)
  })

  it('different seeds produce different (but same-topology) shapes', () => {
    const base = { radius: num(0.3), irregularity: num(0.35), detail: num(1) }
    const a = callRock({ ...base, seed: num(1) })
    const b = callRock({ ...base, seed: num(2) })
    expect(a.faces).toEqual(b.faces) // topology unaffected by seed
    expect(a.vertices).not.toEqual(b.vertices)
  })

  it('applies non-uniform stretch to each axis independently', () => {
    const out = callRock({ radius: num(1), irregularity: num(0), detail: num(1), stretch: numList([2, 1, 0.5]) })
    const xs = out.vertices.map((v) => Math.abs(v[0]))
    const ys = out.vertices.map((v) => Math.abs(v[1]))
    const zs = out.vertices.map((v) => Math.abs(v[2]))
    expect(Math.max(...xs)).toBeCloseTo(2, 5)
    expect(Math.max(...ys)).toBeCloseTo(1, 5)
    expect(Math.max(...zs)).toBeCloseTo(0.5, 5)
  })

  it('defaults irregularity/seed/detail/stretch when omitted', () => {
    const out = callRock({ radius: num(1) })
    expect(out.vertices).toHaveLength(42) // detail defaults to 1
    for (const v of out.vertices) {
      const len = Math.hypot(v[0], v[1], v[2])
      // default irregularity=0.35 → within [0.65, 1.35] of radius=1
      expect(len).toBeGreaterThanOrEqual(0.65 - 1e-9)
      expect(len).toBeLessThanOrEqual(1.35 + 1e-9)
    }
  })

  it('rejects invalid args', () => {
    expect(() => callRock({ radius: num(0) })).toThrow(BakerError)
    expect(() => callRock({ radius: num(-1) })).toThrow(BakerError)
    expect(() => callRock({ radius: num(1), irregularity: num(1.5) })).toThrow(/irregularity/)
    expect(() => callRock({ radius: num(1), irregularity: num(-0.1) })).toThrow(/irregularity/)
    expect(() => callRock({ radius: num(1), detail: num(3) })).toThrow(/detail/)
    expect(() => callRock({ radius: num(1), detail: num(-1) })).toThrow(/detail/)
    expect(() => callRock({ radius: num(1), stretch: numList([1, -1, 1]) })).toThrow(/stretch/)
    expect(() => callRock({})).toThrow(/radius/)
  })

  it('boulder is a synonym of rock (identical output for identical args)', () => {
    const args = { radius: num(0.4), irregularity: num(0.3), seed: num(5), detail: num(1) }
    expect(boulder(undefined, args)).toEqual(callRock(args))
  })
})
