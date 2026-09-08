// @vitest-environment jsdom
//
// Single-click free-brush latency guard (USER repro: one click = ~2s before the
// tile shows). The dominant cost was a full buildVoxelMaster() re-bake on every
// painted cell. This test mounts the real billboard plugin, paints the FIRST
// cell of a layer (forces the initial bake), then paints additional cells the
// way a free-brush click does (store.paintBakedCells) and asserts buildVoxelMaster
// is NOT called again — additive paint must go through the O(k) incremental
// append path, never a full re-bake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildSpy = vi.fn()
const appendSpy = vi.fn()

vi.mock('../buildVoxelMaster', async () => {
  const actual = await vi.importActual<typeof import('../buildVoxelMaster')>('../buildVoxelMaster')
  return {
    ...actual,
    buildVoxelMaster: (...args: Parameters<typeof actual.buildVoxelMaster>) => {
      buildSpy()
      return actual.buildVoxelMaster(...args)
    },
    appendCellsToVoxelMaster: (...args: Parameters<typeof actual.appendCellsToVoxelMaster>) => {
      const r = actual.appendCellsToVoxelMaster(...args)
      appendSpy(r !== null)
      return r
    },
  }
})

import { render, act } from '@testing-library/react'
import { useRenderStore } from '../../../store'
import { RenderCanvas } from '../../../host/RenderCanvas'
import { setServerImageResolver } from '../../../framework/asset/imageCache'
import { setCanvas2DBackend, type Surface2D } from '../../../framework/canvas2d'

// A no-op 2D context so buildVoxelMaster/appendCellsToVoxelMaster can actually
// draw in jsdom (which otherwise throws on getContext). Mirrors the recording
// backend used by incrementalBake.test — here we only need it to not be null.
function makeStubSurface(width: number, height: number): Surface2D {
  return {
    width,
    height,
    getContext: () => ({
      imageSmoothingEnabled: false,
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
      fillRect: () => { }, clearRect: () => { }, strokeRect: () => { },
      drawImage: () => { }, save: () => { }, restore: () => { },
      beginPath: () => { }, rect: () => { }, clip: () => { },
      setLineDash: () => { }, moveTo: () => { }, lineTo: () => { }, stroke: () => { },
      closePath: () => { }, fill: () => { },
    } as unknown as CanvasRenderingContext2D),
  } as unknown as Surface2D
}

beforeEach(() => {
  useRenderStore.getState().reset()
  buildSpy.mockClear()
  appendSpy.mockClear()
  setCanvas2DBackend({ createSurface: makeStubSurface, devicePixelRatio: () => 1 })
  // Resolve the tile sprite synchronously so the asset path is exercised without
  // any async image decode in the click→draw path.
  setServerImageResolver((alias) => {
    const m = alias.match(/\[([^\]]*)\]/g)
    const name = m?.[4]?.slice(1, -1) ?? alias
    return { alias: name, width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 }
  })
})

afterEach(() => {
  setServerImageResolver(null)
  setCanvas2DBackend({
    createSurface: (w: number, h: number) => ({ width: w, height: h, getContext: () => null } as unknown as Surface2D),
    devicePixelRatio: () => 1,
  })
  vi.restoreAllMocks()
})

function setupBakedAssetLayer(): string {
  const s = useRenderStore.getState()
  s.setViewMode('topBillboard')
  s.setDrawMode('asset')
  // A bracketed alias whose 5th field is the asset name and that carries a
  // tileType → matchAssetEntry binds it as a 1-footprint autotile (incremental-
  // safe), exactly like incrementalBake.test.ts.
  const alias = '[0][1][2][3][Grass][5][6][7][floor][16][10][11][v]'
  s.setAliasMetas([{ alias, tileType: 'floor' }])
  s.setLayers('n', 'scene_output', [], [{ id: 1, name: 'Grass', type: 'tile' }])
  // Seed cells spanning x=0..4 with a gap at x=2 so the painted cell lands INSIDE
  // the existing master bbox (the realistic "paint onto a populated layer" case
  // the user reported as ~2s/click).
  s.setBakedLayers([
    {
      nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'Grass', assetAlias: alias, assetType: 'tile', version: 1,
      cells: [0, 1, 3, 4].map((x) => ({ x, y: 0, z: 0, token: 'Grass' })),
    },
  ])
  return 'baked:/Floor'
}

describe('single-click free-brush bake path', () => {
  it('does NOT fully re-bake the master when an additive cell is painted', async () => {
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    // Let initial mount + first bake settle.
    await act(async () => { await Promise.resolve() })

    const initialBuilds = buildSpy.mock.calls.length
    expect(initialBuilds).toBeGreaterThanOrEqual(1) // initial structural bake happened

    // Simulate a single free-brush click landing an in-bbox additive cell (x=2 gap).
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 2, y: 0, z: 0, token: 'Grass' }])
      await Promise.resolve()
    })

    // The additive paint must NOT trigger another full buildVoxelMaster.
    expect(buildSpy.mock.calls.length).toBe(initialBuilds)
    // …it must have gone through the incremental append (and succeeded).
    expect(appendSpy).toHaveBeenCalled()
    expect(appendSpy.mock.calls.some(([ok]) => ok === true)).toBe(true)
  })

  it('falls back to a full re-bake when a cell is REMOVED (not append-safe)', async () => {
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const initialBuilds = buildSpy.mock.calls.length

    await act(async () => {
      // remove an existing cell (x=4) → removal is not incremental-safe → full rebuild
      useRenderStore.getState().paintBakedCells(key, (prev) => prev.filter((c) => !(c.x === 4 && c.y === 0 && c.z === 0)))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(buildSpy.mock.calls.length).toBeGreaterThan(initialBuilds)
  })

  it('GROWS the master incrementally (no full re-bake) when a cell is painted OUTSIDE the current bbox', async () => {
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const initialBuilds = buildSpy.mock.calls.length
    expect(initialBuilds).toBeGreaterThanOrEqual(1)
    appendSpy.mockClear()

    // The seeded master tightly covers x=0..4, y=0. Painting far away (x=50)
    // lands OUTSIDE the current canvas — previously this ALWAYS fell back to a
    // full buildVoxelMaster (the user's "every click is full-rebuild" bug).
    // Now it must take the incremental bbox-grow append path instead.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 50, y: 0, z: 0, token: 'Grass' }])
      await Promise.resolve()
    })

    // No additional full rebuild…
    expect(buildSpy.mock.calls.length).toBe(initialBuilds)
    // …and the grow append path succeeded.
    expect(appendSpy.mock.calls.some(([ok]) => ok === true)).toBe(true)
  })

  it('keeps growing incrementally across many far-apart paints (paint across the canvas)', async () => {
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const initialBuilds = buildSpy.mock.calls.length
    appendSpy.mockClear()

    // Simulate dragging a free brush across the canvas: each click lands a new
    // cell beyond the previous extent. Every one must be an incremental grow.
    for (let x = 10; x <= 30; x += 5) {
      await act(async () => {
        useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x, y: x % 7, z: 0, token: 'Grass' }])
        await Promise.resolve()
      })
    }

    expect(buildSpy.mock.calls.length).toBe(initialBuilds)
    expect(appendSpy.mock.calls.every(([ok]) => ok === true)).toBe(true)
  })

  it('END-TO-END: a 2nd paint into an already-baked layer takes the incremental path (caller reaches append with a valid snapshot)', async () => {
    // Mirror the REAL app sequence: a layer that ALREADY has content (so the
    // initial bake ran at mount and attached the incremental snapshot), then the
    // user clicks to paint another cell. That 2nd paint MUST take the append/grow
    // path — NOT a second full buildVoxelMaster. (Earlier tests pre-seeded then
    // painted in one place; this one explicitly asserts master.incremental is
    // present after the first build AND that the caller reaches append.)
    const s = useRenderStore.getState()
    s.setViewMode('topBillboard')
    s.setDrawMode('asset')
    const alias = '[0][1][2][3][Grass][5][6][7][floor][16][10][11][v]'
    s.setAliasMetas([{ alias, tileType: 'floor' }])
    s.setLayers('n', 'scene_output', [], [{ id: 1, name: 'Grass', type: 'tile' }])
    s.setBakedLayers([
      {
        nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'Grass',
        assetAlias: alias, assetType: 'tile', version: 1,
        cells: [{ x: 0, y: 0, z: 0, token: 'Grass' }],
      },
    ])
    const key = 'baked:/Floor'

    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    // First build happened at mount (1 cell). Capture baseline + clear append spy.
    const buildsAfterMount = buildSpy.mock.calls.length
    expect(buildsAfterMount).toBeGreaterThan(0)
    appendSpy.mockClear()

    // Paint a 2nd cell adjacent to the first. MUST be incremental (append/grow),
    // NOT a 2nd full rebuild.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 1, y: 0, z: 0, token: 'Grass' }])
      await Promise.resolve()
    })

    expect(buildSpy.mock.calls.length).toBe(buildsAfterMount) // no 2nd full rebuild
    expect(appendSpy.mock.calls.some(([ok]) => ok === true)).toBe(true) // append succeeded
  })

  it('DEAD-STOP regression: a paint that forces a full rebuild does NOT latch painting off — subsequent additive paints still reach visible', async () => {
    // User repro: while painting, drawing intermittently dead-stops — nothing can
    // be painted anymore. The clue was a stage timeline opened (mousedown) but
    // never closed (Σ grew to ~2s), meaning the append effect kept early-returning
    // and the pipeline never recovered. The trigger is a paint that bails to a full
    // rebuild (removal / non-append change) interleaved with additive paints; after
    // the rebuild, the next additive paint MUST still append (not be silently
    // dropped because builtStructuralKeyRef / lastPaintDelta were left desynced).
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    // 1) an additive paint — incremental append works.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 2, y: 0, z: 0, token: 'Grass' }])
      await Promise.resolve()
    })

    // 2) a REMOVAL — not append-safe → forces a full rebuild (the structural churn
    //    that can desync the incremental baseline).
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => prev.filter((c) => !(c.x === 4 && c.y === 0 && c.z === 0)))
      await Promise.resolve()
      await Promise.resolve()
    })

    appendSpy.mockClear()
    const buildsBefore = buildSpy.mock.calls.length

    // 3) MORE additive paints AFTER the rebuild. Each must still append (painting
    //    is NOT latched off). Pre-fix, the pipeline could stay stuck here.
    for (let x = 6; x <= 9; x++) {
      await act(async () => {
        useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x, y: 0, z: 0, token: 'Grass' }])
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    // Every post-rebuild paint reached the store…
    const finalCells = useRenderStore.getState().bakedLayers[key].cells
    expect(finalCells.some((c) => c.x === 9 && c.y === 0 && c.z === 0)).toBe(true)
    // …and the incremental append actually ran + succeeded for them (not dropped),
    // without falling back to a full rebuild per paint.
    expect(appendSpy.mock.calls.some(([ok]) => ok === true)).toBe(true)
    expect(buildSpy.mock.calls.length).toBe(buildsBefore)
  })

  it('DEAD-STOP regression: same-millisecond paints (version collision) still all bake', async () => {
    // A fast stroke can produce multiple paintBakedCells in the SAME ms, so the
    // store stamps them with an identical Date.now() version. contentSignature is
    // `${layerIdx}@${version}`, so two distinct paints with the same version yield
    // the SAME signature → the append effect's [contentSig] dep doesn't change →
    // the effect can skip, leaving cells committed to the store but never baked
    // onto the master (visually dead). Pin Date.now() to force the collision and
    // assert the later cell still becomes visible (append ran for it).
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    appendSpy.mockClear()
    const fixedNow = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    try {
      await act(async () => {
        useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 2, y: 0, z: 0, token: 'Grass' }])
        await Promise.resolve()
      })
      // Second paint in the SAME pinned ms → identical version/contentSig.
      await act(async () => {
        useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 6, y: 0, z: 0, token: 'Grass' }])
        await Promise.resolve()
        await Promise.resolve()
      })
    } finally {
      spy.mockRestore()
    }

    // The 2nd same-ms cell must have been baked (append ran for it), not silently
    // stuck because the content signature didn't change.
    const cells = useRenderStore.getState().bakedLayers[key].cells
    expect(cells.some((c) => c.x === 6 && c.y === 0 && c.z === 0)).toBe(true)
    expect(appendSpy.mock.calls.filter(([ok]) => ok === true).length).toBeGreaterThanOrEqual(2)
  })
})
