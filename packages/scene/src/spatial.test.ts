import { describe, expect, it } from 'vitest'

import { HOST_FUNCTION_NAMES } from './host.js'
import type { SceneCallRecord, SceneCallSource } from './host.js'
import { diagnoseScenePlacement } from './spatial.js'

function call(
  functionName: string,
  args: Record<string, unknown>,
  result: unknown,
  id = functionName,
  source?: SceneCallSource,
): SceneCallRecord {
  return { id, functionName, args, result, argRefs: [], reused: false, ...(source ? { source } : {}) }
}

describe('diagnoseScenePlacement', () => {
  it('stays quiet when only a mesh sitting on the Heightfield plane is hung', () => {
    const terrain = {
      type: 'heightfield',
      geometry: { kind: 'plane', origin: [0, 0], width: 10, height: 10 },
      columns: 2,
      rows: 2,
      height: [[1, 2], [2, 3]],
    }
    const mesh = { kind: 'mesh', positions: [0, 0, 1, 10, 0, 2, 0, 10, 3], indices: [0, 1, 2] }
    expect(diagnoseScenePlacement([
      call('heightfield', {}, { heightfield: terrain }),
      call('sceneNode', { name: 'terrain', geometry: mesh }, { scene: {} }),
    ])).toEqual([])
  })

  it('names the off-terrain sceneNode, not the one that sits on the field', () => {
    const terrain = {
      type: 'heightfield',
      geometry: { kind: 'plane', origin: [0, 0], width: 20, height: 20 },
      columns: 2,
      rows: 2,
      height: [[1, 2], [2, 4]],
    }
    const house = { kind: 'mesh', positions: [4, 4, 2, 6, 4, 2, 4, 6, 6], indices: [0, 1, 2] }
    const wall = { kind: 'mesh', positions: [4, -16, 2, 6, -16, 2, 4, -12, 6], indices: [0, 1, 2] }
    const found = diagnoseScenePlacement([
      call('heightfield', {}, { heightfield: terrain }),
      call('sceneNode', { name: 'palace', geometry: house }, { scene: {} }, 'palace', {
        file: 'keep.scene.ts',
        line: 12,
      }),
      call('sceneNode', { name: 'keep-wall', geometry: wall }, { scene: {} }, 'keep-wall', {
        file: 'walls.scene.ts',
        line: 42,
      }),
    ])
    const ground = found.find((item) => item.code === 'SCENE_GROUND_MISALIGNED')
    expect(ground?.message).toContain('"keep-wall" (walls.scene.ts:42)')
    expect(ground?.message).not.toContain('"palace"')
    expect(ground?.source).toEqual(expect.objectContaining({
      file: 'walls.scene.ts',
      line: 42,
      statementId: 'keep-wall',
    }))
    expect(ground?.actual).toEqual({
      nodes: [expect.objectContaining({
        name: 'keep-wall',
        statementId: 'keep-wall',
        file: 'walls.scene.ts',
        line: 42,
      })],
    })
    expect(found.map((item) => item.code)).toEqual(expect.arrayContaining([
      'SCENE_GROUND_MISALIGNED',
      'SCENE_FRAME_MISALIGNED',
    ]))
  })

  it('reports Z clearance as advisory, not a drape fault', () => {
    const terrain = {
      type: 'heightfield',
      geometry: { kind: 'plane', origin: [0, 0], width: 20, height: 20 },
      columns: 2,
      rows: 2,
      height: [[8, 10], [10, 12]],
    }
    const deck = { kind: 'mesh', positions: [4, 4, 40, 6, 4, 40, 4, 6, 42], indices: [0, 1, 2] }
    const found = diagnoseScenePlacement([
      call('heightfield', {}, { heightfield: terrain }),
      call('sceneNode', { name: 'overpass', geometry: deck }, { scene: {} }, 'overpass', {
        file: 'span.scene.ts',
        line: 20,
      }),
    ])
    expect(found.map((item) => item.code)).toContain('SCENE_Z_CLEARANCE')
    expect(found.map((item) => item.code)).not.toContain('SCENE_NOT_DRAPED')
    expect(found.find((item) => item.code === 'SCENE_Z_CLEARANCE')?.message).toContain('"overpass" (span.scene.ts:20)')
    expect(found.find((item) => item.code === 'SCENE_Z_CLEARANCE')?.howToFix).toEqual(expect.arrayContaining([
      expect.stringMatching(/placeOnGround/),
    ]))
  })

  it('flags a mesh that overlaps terrain XY but does not sit on sampleHeight', () => {
    const terrain = {
      type: 'heightfield',
      geometry: { kind: 'plane', origin: [0, 0], width: 20, height: 20 },
      columns: 2,
      rows: 2,
      height: [[8, 10], [10, 12]],
    }
    const hut = { kind: 'mesh', positions: [8, 8, 11, 10, 8, 11, 8, 10, 14, 10, 10, 14], indices: [0, 1, 2] }
    const found = diagnoseScenePlacement([
      call('heightfield', {}, { heightfield: terrain }),
      call('sceneNode', { name: 'hut', geometry: hut }, { scene: {} }, 'hut', {
        file: 'camp.scene.ts',
        line: 6,
      }),
    ])
    const sit = found.find((item) => item.code === 'SCENE_NOT_ON_GROUND')
    expect(sit?.message).toContain('"hut" (camp.scene.ts:6)')
    expect(sit?.howToFix).toEqual(expect.arrayContaining([
      expect.stringMatching(/placeOnGround/),
    ]))
    expect(found.map((item) => item.code)).not.toContain('SCENE_Z_CLEARANCE')
  })

  it('flags intersecting hung meshes and the clip ratio', () => {
    const road = { kind: 'mesh', positions: [0, 0, 0, 20, 0, 0, 0, 4, 1, 20, 4, 1], indices: [0, 1, 2] }
    const house = { kind: 'mesh', positions: [8, 0, 0, 14, 0, 0, 8, 6, 4, 14, 6, 4], indices: [0, 1, 2] }
    const found = diagnoseScenePlacement([
      call('sceneNode', { name: 'avenue', geometry: road }, { scene: {} }, 'avenue', {
        file: 'street.scene.ts',
        line: 10,
      }),
      call('sceneNode', { name: 'shop', geometry: house }, { scene: {} }, 'shop', {
        file: 'block.scene.ts',
        line: 4,
      }),
    ])
    const clip = found.find((item) => item.code === 'SCENE_MESH_INTERSECTS')
    expect(clip?.message).toContain('"avenue" (street.scene.ts:10)')
    expect(clip?.message).toContain('"shop" (block.scene.ts:4)')
    expect(clip?.actual).toEqual(expect.objectContaining({
      pairs: [expect.objectContaining({ clipRatio: expect.any(Number) })],
    }))
  })

  it('reads sceneNode structure/part and flags spliced pavement', () => {
    const west = { kind: 'mesh', positions: [0, 0, 2, 30, 0, 2, 0, 4, 2, 30, 4, 2], indices: [0, 1, 2] }
    const east = { kind: 'mesh', positions: [28, 0, 2, 60, 0, 2, 28, 4, 2, 60, 4, 2], indices: [0, 1, 2] }
    const found = diagnoseScenePlacement([
      call('sceneNode', { name: 'west', geometry: west, structure: 'road', part: 'pavement' }, { scene: {} }, 'west', {
        file: 'viaduct.scene.ts',
        line: 18,
      }),
      call('sceneNode', { name: 'east', geometry: east, structure: 'road', part: 'pavement' }, { scene: {} }, 'east', {
        file: 'viaduct.scene.ts',
        line: 19,
      }),
    ])
    expect(found.some((item) => item.code === 'SCENE_ROAD_PAVEMENT_SPLIT')).toBe(true)
    expect(found.find((item) => item.code === 'SCENE_ROAD_PAVEMENT_SPLIT')?.message).toContain('"west" (viaduct.scene.ts:18)')
  })

  it('flags one pavement mesh that is tessellated as separate triangle islands', () => {
    const deck = {
      kind: 'mesh',
      positions: [
        0, 0, 8, 8, 0, 8, 0, 4, 8, 8, 4, 8,
        10, 0, 8, 18, 0, 8, 10, 4, 8, 18, 4, 8,
      ],
      indices: [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6],
    }
    const found = diagnoseScenePlacement([
      call('sceneNode', { name: 'viaduct-deck', geometry: deck, structure: 'road', part: 'pavement' }, { scene: {} }, 'deck', {
        file: 'viaduct.scene.ts',
        line: 44,
      }),
    ])
    const split = found.find((item) => item.code === 'SCENE_ROAD_PAVEMENT_SPLIT')
    expect(split?.severity).toBe('error')
    expect(split?.message).toMatch(/triangle-connected pavement island/)
    expect(split?.message).toContain('"viaduct-deck" (viaduct.scene.ts:44)')
  })

  it('flags a collapsed polyline as degenerate operating geometry', () => {
    const found = diagnoseScenePlacement([
      call('polyline2d', { points: [[1, 1], [1, 1]] }, { geometry: { kind: 'polyline', points: [[1, 1], [1, 1]] } }, 'spine', {
        file: 'path.scene.ts',
        line: 3,
      }),
    ])
    expect(found[0]?.code).toBe('SCENE_GEOMETRY_DEGENERATE')
    expect(found[0]?.source).toEqual(expect.objectContaining({ file: 'path.scene.ts', line: 3 }))
  })

  it('keeps sampleHeight off the recorded host function list', () => {
    expect(HOST_FUNCTION_NAMES).not.toContain('sampleHeight')
    expect(HOST_FUNCTION_NAMES).not.toContain('sampleSurface')
  })

  it('flags authored point3d that is not on the Heightfield as SCENE_NOT_ON_SURFACE', () => {
    const terrain = {
      type: 'heightfield',
      geometry: { kind: 'plane', origin: [0, 0], width: 10, height: 10 },
      columns: 2,
      rows: 2,
      height: [[1, 2], [2, 3]],
    }
    const found = diagnoseScenePlacement([
      call('heightfield', {}, { heightfield: terrain }),
      call('point3d', { x: 5, y: 5, z: 40 }, { geometry: { kind: 'point3d', x: 5, y: 5, z: 40 } }),
    ])
    expect(found.some((item) => item.code === 'SCENE_NOT_ON_SURFACE')).toBe(true)
  })
})
