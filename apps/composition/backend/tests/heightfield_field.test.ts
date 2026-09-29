import { describe, expect, it } from 'vitest'

import { createGrid } from '../../batteries/Grid/init/create_grid/index.ts'
import { heightfield } from '../../batteries/Modeling/heightfield/heightfield/index.ts'
import { heightfieldExplode } from '../../batteries/Modeling/heightfield/heightfield_explode/index.ts'
import { heightfieldSetMask } from '../../batteries/Modeling/heightfield/heightfield_set_mask/index.ts'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.ts'
import { executionOutputDiagnostics } from '../src/scene-script/diagnostics.js'
import {
  sampleHeightfieldWorld,
  unwrapHeightfield,
} from '../../vendor/shared/types/scene/heightfieldField.ts'

function plane(origin: [number, number], width: number, height: number) {
  return basePlane({ origin, width, height }).geometry
}

describe('Heightfield packet', () => {
  it('binds region, lattice, height, default mask, and samples in world metres', () => {
    const field = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
    })
    const packet = field.heightfield!
    expect(packet.type).toBe('heightfield')
    expect(packet).not.toHaveProperty('cellSize')
    expect(packet).not.toHaveProperty('kind')
    expect(packet.columns).toBe(2)
    expect(packet.rows).toBe(2)
    expect(packet.mask).toEqual([[1, 1], [1, 1]])
    expect(packet.attributes).toEqual({})
    expect(sampleHeightfieldWorld(packet, 2.5, 2)).toBeCloseTo(0, 5)
    expect(sampleHeightfieldWorld(packet, 7.5, 6)).toBeCloseTo(30, 5)
    expect(sampleHeightfieldWorld(packet, 5, 4)).toBeCloseTo(15, 5)
    expect(sampleHeightfieldWorld(packet, -1, 0)).toBeUndefined()
  })

  it('accepts mask and a named attribute dict on the same lattice', () => {
    const hardness = createGrid({ columns: 2, rows: 2, fill: 0.4 }).grid
    const flow = createGrid({ columns: 2, rows: 2, fill: 0.1 }).grid
    const field = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
      mask: [[1, 0], [1, 0]],
      attributes: { hardness, flow },
    })
    expect(field.error).toBeUndefined()
    expect(field.heightfield?.mask).toEqual([[1, 0], [1, 0]])
    expect(field.heightfield?.attributes).toEqual({ hardness, flow })

    const fromTree = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
      attributes: [{ path: [], items: [{ hardness }] }],
    })
    expect(fromTree.heightfield?.attributes).toEqual({ hardness })
  })

  it('rejects a mask or attribute on a different lattice', () => {
    const mismatched = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
      mask: [[1, 1, 1]],
    })
    expect(mismatched.heightfield).toBeUndefined()
    expect(mismatched.error).toMatch(/mask/)

    const badAttr = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
      attributes: { flow: [[1]] },
    })
    expect(badAttr.error).toMatch(/attribute 'flow'/)
  })

  it('explodes the packet into its parts', () => {
    const built = heightfield({
      geometry: plane([2, 4], 12, 6),
      height: createGrid({ columns: 3, rows: 2, fill: 7 }).grid,
    })
    const parts = heightfieldExplode({ heightfield: built })
    expect(parts.error).toBeUndefined()
    expect(parts.columns).toBe(3)
    expect(parts.rows).toBe(2)
    expect(parts.height).toEqual(built.heightfield?.height)
    expect(parts.mask).toEqual(built.heightfield?.mask)
    expect(parts.geometry?.width).toBe(12)
    expect(parts.attributes).toEqual({})
    expect(unwrapHeightfield(built)).toBe(built.heightfield)
  })

  it('replaces mask and keeps height, attributes, and geometry', () => {
    const hardness = createGrid({ columns: 2, rows: 2, fill: 0.4 }).grid
    const built = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
      mask: [[1, 1], [1, 1]],
      attributes: { hardness },
    })
    const marked = heightfieldSetMask({
      heightfield: built,
      mask: [[1, 0], [1, 0]],
    })
    expect(marked.error).toBeUndefined()
    expect(marked.heightfield?.mask).toEqual([[1, 0], [1, 0]])
    expect(marked.heightfield?.height).toEqual([[0, 10], [20, 30]])
    expect(marked.heightfield?.attributes).toEqual({ hardness })
    expect(marked.heightfield?.geometry?.width).toBe(10)
    expect(marked.heightfield?.columns).toBe(2)
    expect(marked.heightfield?.rows).toBe(2)
  })

  it('rejects a missing mask or a different lattice', () => {
    const built = heightfield({
      geometry: plane([0, 0], 10, 8),
      height: [[0, 10], [20, 30]],
    })
    const missing = heightfieldSetMask({ heightfield: built })
    expect(missing.heightfield).toBeUndefined()
    expect(missing.error).toMatch(/mask/)

    const mismatched = heightfieldSetMask({
      heightfield: built,
      mask: [[1, 1, 1]],
    })
    expect(mismatched.heightfield).toBeUndefined()
    expect(mismatched.error).toMatch(/mask is 3×1, expected 2×2/)
  })

  it('does not warn when the height grid and plane share the same aspect', () => {
    const field = heightfield({
      geometry: plane([0, 0], 10, 10),
      height: createGrid({ columns: 16, rows: 16, fill: 1 }).grid,
    })
    expect(field.error).toBeUndefined()
    expect(field._warnings).toEqual([])
    expect(field.heightfield?.stretch).toBeUndefined()
    expect(executionOutputDiagnostics({
      executionId: 'exec-square',
      status: 'completed',
      outputs: {
        field: { heightfield: [{ path: [0], items: [field.heightfield] }] },
      },
      durationMs: 1,
    }, [
      {
        moduleId: 'main',
        file: 'main.scene.ts',
        statementId: 'field',
        source: { file: 'main.scene.ts', start: 1, end: 2, line: 1, column: 1, statementId: 'field' },
        entityId: 'field',
        runtimeNodeIds: ['field'],
        runtimeEdgeIds: [],
      },
    ])).toEqual([])
  })

  it('lifts stretch metrics as SCENE_GRID_STRETCH, not compose warnings', () => {
    const field = heightfield({
      geometry: plane([0, 0], 20, 8),
      height: createGrid({ columns: 4, rows: 2, fill: 1 }).grid,
    })
    expect(field._warnings[0]?.code).toBe('SCENE_GRID_STRETCH')
    const diagnostics = executionOutputDiagnostics({
      executionId: 'exec-stretch',
      status: 'completed',
      outputs: {
        field: { heightfield: [{ path: [], items: [field.heightfield] }] },
      },
      durationMs: 1,
    }, [
      {
        moduleId: 'main',
        file: 'main.scene.ts',
        statementId: 'field',
        source: { file: 'main.scene.ts', start: 1, end: 2, line: 1, column: 1, statementId: 'field' },
        entityId: 'field',
        runtimeNodeIds: ['field'],
        runtimeEdgeIds: [],
      },
    ])
    expect(diagnostics.map((item) => item.code)).toEqual(['SCENE_GRID_STRETCH'])
  })
})
