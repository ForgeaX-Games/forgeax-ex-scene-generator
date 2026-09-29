import { describe, expect, it } from 'vitest'

import {
  HOST_FUNCTION_NAMES,
  HOST_FUNCTION_OP_IDS,
  HOST_PRIMARY_OUTPUT,
  SCENE_CALL_ID,
  SCENE_CALL_PORT,
  addChild,
  basePlane,
  bindSceneHostGlobals,
  collectArgRefs,
  createSceneRunHost,
  heightfield,
  runWithSceneHost,
  tagResult,
} from './host.js'

describe('collectArgRefs', () => {
  it('walks array arguments so addChild.nodes keeps every child', () => {
    const child = tagResult({ scene: { focus: 'terrain' } }, 'terrainNode') as { scene: object }
    const parent = tagResult({ scene: { focus: 'root' } }, 'empty') as { scene: object }
    const refs = collectArgRefs({
      scene: parent.scene,
      nodes: [child.scene],
    })
    expect(refs).toEqual(expect.arrayContaining([
      { from: 'empty', port: 'scene', arg: 'scene' },
      { from: 'terrainNode', port: 'scene', arg: 'nodes' },
    ]))
  })

  it('keeps multiple tagged items on one list port', () => {
    const a = tagResult({ scene: { focus: 'a' } }, 'a') as { scene: object }
    const b = tagResult({ scene: { focus: 'b' } }, 'b') as { scene: object }
    expect(collectArgRefs({ nodes: [a.scene, b.scene] })).toEqual([
      { from: 'a', port: 'scene', arg: 'nodes' },
      { from: 'b', port: 'scene', arg: 'nodes' },
    ])
  })

  it('records host _warnings as execute diagnostics', () => {
    const host = createSceneRunHost({
      implementations: {
        heightfield: () => ({
          heightfield: { type: 'heightfield' },
          _warnings: [{
            code: 'SCENE_GRID_STRETCH',
            message: 'Height grid 8×4 covers plane 120.0×40.0 m; stretch ratio 1.500 (anisotropic)',
          }],
        }),
      },
    })
    runWithSceneHost(host, () => {
      heightfield({})
    })
    expect(host.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SCENE_GRID_STRETCH',
        severity: 'warning',
        operation: 'heightfield',
      }),
    ]))
  })

  it('records SCENE_HOST_FAILED when a host function returns error', () => {
    const host = createSceneRunHost({
      implementations: {
        addChild: () => ({ error: 'nodes[1] focus is that source\'s own root; cannot graft the root itself' }),
      },
    })
    runWithSceneHost(host, () => {
      addChild({ scene: {}, nodes: [] })
    })
    expect(host.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SCENE_HOST_FAILED',
        severity: 'error',
        operation: 'addChild',
      }),
    ]))
  })

  it('re-enters the captured host when the bundle evaluates outside AsyncLocalStorage', () => {
    const host = createSceneRunHost({
      implementations: {
        basePlane: () => ({ geometry: { kind: 'plane', width: 10, height: 4 } }),
      },
    })
    bindSceneHostGlobals(host)
    const shim = (globalThis as typeof globalThis & {
      __forgeaxSceneHost?: { basePlane: (args?: Record<string, unknown>) => { kind?: string } }
    }).__forgeaxSceneHost
    const out = shim?.basePlane({ width: 10 })
    expect(out?.kind).toBe('plane')
    expect(host.trace.map((item) => item.functionName)).toEqual(['basePlane'])
  })

  it('returns the Geometry itself from a single-output host call', () => {
    const host = createSceneRunHost({
      implementations: {
        basePlane: () => ({ geometry: { kind: 'plane', width: 10, height: 4 } }),
      },
    })
    const out = runWithSceneHost(host, () => basePlane({ width: 10 })) as { kind?: string; width?: number }
    expect(out).toEqual({ kind: 'plane', width: 10, height: 4 })
    expect(collectArgRefs({ geometry: out })).toEqual([
      { from: host.trace[0]?.id, port: 'geometry', arg: 'geometry' },
    ])
  })

  it('does not invent refs for untagged grids', () => {
    expect(collectArgRefs({ grid: [[1, 2], [3, 4]] })).toEqual([])
  })

  it('reads call-id symbols on the tagged object', () => {
    const value = { geometry: { kind: 'plane' } }
    Object.defineProperty(value, SCENE_CALL_ID, { value: 'world' })
    Object.defineProperty(value.geometry, SCENE_CALL_ID, { value: 'world' })
    Object.defineProperty(value.geometry, SCENE_CALL_PORT, { value: 'geometry' })
    expect(collectArgRefs({ geometry: value.geometry })).toEqual([
      { from: 'world', port: 'geometry', arg: 'geometry' },
    ])
  })

  it('records geometryMask as a single-output grid host call', () => {
    expect(HOST_FUNCTION_NAMES).toContain('geometryMask')
    expect(HOST_FUNCTION_OP_IDS.geometryMask).toBe('geometry_mask')
    expect(HOST_PRIMARY_OUTPUT.geometryMask).toBe('grid')
  })

  it('records heightfieldSetMask as a single-output heightfield host call', () => {
    expect(HOST_FUNCTION_NAMES).toContain('heightfieldSetMask')
    expect(HOST_FUNCTION_OP_IDS.heightfieldSetMask).toBe('heightfield_set_mask')
    expect(HOST_PRIMARY_OUTPUT.heightfieldSetMask).toBe('heightfield')
  })

  it('records heightfieldMesh as a single-output geometry host call', () => {
    expect(HOST_FUNCTION_NAMES).toContain('heightfieldMesh')
    expect(HOST_FUNCTION_OP_IDS.heightfieldMesh).toBe('heightfield_mesh')
    expect(HOST_PRIMARY_OUTPUT.heightfieldMesh).toBe('geometry')
  })

  it('records box / transform / placeOnGround as single-output geometry host calls', () => {
    expect(HOST_FUNCTION_NAMES).toContain('box')
    expect(HOST_FUNCTION_NAMES).toContain('transform')
    expect(HOST_FUNCTION_NAMES).toContain('placeOnGround')
    expect(HOST_FUNCTION_OP_IDS.box).toBe('box')
    expect(HOST_FUNCTION_OP_IDS.transform).toBe('transform')
    expect(HOST_FUNCTION_OP_IDS.placeOnGround).toBe('place_on_ground')
    expect(HOST_PRIMARY_OUTPUT.box).toBe('geometry')
    expect(HOST_PRIMARY_OUTPUT.transform).toBe('geometry')
    expect(HOST_PRIMARY_OUTPUT.placeOnGround).toBe('geometry')
  })

  it('records Geometry3d constructors and liftToSurface', () => {
    expect(HOST_FUNCTION_NAMES).toContain('point3d')
    expect(HOST_FUNCTION_NAMES).toContain('polyline3d')
    expect(HOST_FUNCTION_NAMES).toContain('spline3d')
    expect(HOST_FUNCTION_NAMES).toContain('polygon3d')
    expect(HOST_FUNCTION_NAMES).toContain('network3d')
    expect(HOST_FUNCTION_NAMES).toContain('liftToSurface')
    expect(HOST_FUNCTION_NAMES).toContain('surfaceBand')
    expect(HOST_FUNCTION_OP_IDS.liftToSurface).toBe('lift_to_surface')
    expect(HOST_FUNCTION_OP_IDS.surfaceBand).toBe('surface_band')
    expect(HOST_PRIMARY_OUTPUT.point3d).toBe('geometry')
    expect(HOST_PRIMARY_OUTPUT.liftToSurface).toBe('geometry')
    expect(HOST_PRIMARY_OUTPUT.surfaceBand).toBe('geometry')
    expect(HOST_FUNCTION_NAMES).not.toContain('sampleSurface')
  })

  it('bundle shim exports every recorded host function', async () => {
    const { hostRuntimeSource } = await import('./runner.js')
    const shim = hostRuntimeSource()
    for (const name of HOST_FUNCTION_NAMES) {
      expect(shim).toContain(`export const ${name} =`)
    }
    expect(shim).toContain('export const heightfieldMesh =')
    expect(shim).toContain('export const sampleSurface =')
    expect(shim).toContain('export const liftToSurface =')
  })

  it('records partition / zone / global / lattice Grid hosts', () => {
    expect(HOST_FUNCTION_OP_IDS.gridComponents).toBe('grid_components')
    expect(HOST_FUNCTION_OP_IDS.gridZonalMean).toBe('grid_zonal_mean')
    expect(HOST_FUNCTION_OP_IDS.gridStats).toBe('grid_stats')
    expect(HOST_FUNCTION_OP_IDS.gridDistance).toBe('grid_distance')
    expect(HOST_FUNCTION_OP_IDS.gridResize).toBe('grid_resize')
    expect(HOST_PRIMARY_OUTPUT.gridComponents).toBe('grid')
    expect(HOST_PRIMARY_OUTPUT.gridZonalMean).toBe('grid')
    expect(HOST_PRIMARY_OUTPUT.gridDistance).toBe('grid')
    expect(HOST_PRIMARY_OUTPUT.gridResize).toBe('grid')
    expect(HOST_PRIMARY_OUTPUT).not.toHaveProperty('gridStats')
  })
})
