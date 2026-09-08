import { describe, expect, it } from 'vitest'

import { emit, makeGeometry, numList, ref, type Geometry } from '../../vendor/dist/shared/types/index.js'
import { gBakeSkinAnimation } from '../../batteries/Animation/Clip/g_bake_skin_animation/index.ts'

function characterGeometry(): Geometry {
  let geometry = makeGeometry()
  geometry = emit(geometry, 'root', 'bone', {
    origin: numList([1, 2, 3]),
    tail: numList([1, 2, 4]),
  })
  geometry = emit(geometry, 'leg', 'bone', {
    origin: numList([1, 2, 3]),
    tail: numList([1, 2, 2]),
    parent: ref('root'),
  })
  geometry = emit(geometry, 'skeleton', 'skeleton', { root: ref('root') })
  return geometry
}

describe('g_bake_skin_animation root motion', () => {
  it('samples sparse three-axis root motion with the shared linear timeline', () => {
    const out = gBakeSkinAnimation({
      geometry: characterGeometry(),
      fps: 2,
      root_motion: JSON.stringify([
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 1, x: 2, y: -1, z: 4 },
      ]),
    })

    expect(out.error).toBe('')
    const clip = out.animation as {
      frameCount: number
      channels: Record<string, number[]>
      rootTranslation: [number, number, number][]
    }
    expect(clip.frameCount).toBe(3)
    expect(clip.channels).toEqual({})
    expect(clip.rootTranslation).toEqual([
      [0, 0, 0],
      [1, -0.5, 2],
      [2, -1, 4],
    ])
  })

  it('combines bone rotation and root translation in one self-contained q_json', () => {
    const out = gBakeSkinAnimation({
      geometry: characterGeometry(),
      fps: 4,
      duration: 1,
      loop: false,
      keyframes: JSON.stringify({
        leg: [{ t: 0, q: -0.4 }, { t: 1, q: 0.4 }],
      }),
      root_motion: JSON.stringify([
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 0.5, x: 0.25, y: 0, z: 1 },
        { t: 1, x: 0.5, y: 0, z: 0 },
      ]),
    })

    expect(out.error).toBe('')
    const clip = out.animation as {
      frameCount: number
      channels: Record<string, number[]>
      rootTranslation: [number, number, number][]
    }
    expect(clip.frameCount).toBe(5)
    expect(clip.channels.leg).toHaveLength(5)
    expect(clip.rootTranslation[2]).toEqual([0.25, 0, 1])

    const geometry = out.geometry as Geometry
    const statement = geometry.statements.find((s) => s.op === 'animation')!
    const qJson = statement.args.q_json as { kind: 'string'; value: string }
    expect(JSON.parse(qJson.value).rootTranslation).toEqual(clip.rootTranslation)
    expect(out.report).toMatchObject({
      skeletonRoot: 'root',
      rootMotion: { frameCount: 5, unit: 'meter' },
    })
  })

  it('uses step interpolation for root motion', () => {
    const out = gBakeSkinAnimation({
      geometry: characterGeometry(),
      fps: 2,
      interpolation: 'step',
      root_motion: JSON.stringify([
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 1, x: 1, y: 2, z: 3 },
      ]),
    })
    const clip = out.animation as { rootTranslation: [number, number, number][] }
    expect(clip.rootTranslation).toEqual([[0, 0, 0], [0, 0, 0], [1, 2, 3]])
  })

  it('rejects malformed root data and ambiguous skeleton roots', () => {
    const malformed = gBakeSkinAnimation({
      geometry: characterGeometry(),
      root_motion: '[{"t":0,"x":null,"y":0,"z":0},{"t":1,"x":0,"y":0,"z":0}]',
    })
    expect(malformed.error).toContain('non-finite')

    let ambiguous = characterGeometry()
    ambiguous = emit(ambiguous, 'skeleton2', 'skeleton', { root: ref('root') })
    const out = gBakeSkinAnimation({
      geometry: ambiguous,
      root_motion: '[{"t":0,"x":0,"y":0,"z":0},{"t":1,"x":0,"y":0,"z":0}]',
    })
    expect(out.error).toContain('exactly one skeleton')
  })

  it('keeps legacy rotation-only clips compatible', () => {
    const out = gBakeSkinAnimation({
      geometry: characterGeometry(),
      q_json: JSON.stringify({
        name: 'legacy',
        fps: 2,
        frameCount: 3,
        channels: { leg: [0, 0.2, 0] },
      }),
    })
    expect(out.error).toBe('')
    expect(out.animation).toMatchObject({
      name: 'legacy',
      frameCount: 3,
      channels: { leg: [0, 0.2, 0] },
    })
    expect((out.animation as { rootTranslation?: unknown }).rootTranslation).toBeUndefined()
  })
})
