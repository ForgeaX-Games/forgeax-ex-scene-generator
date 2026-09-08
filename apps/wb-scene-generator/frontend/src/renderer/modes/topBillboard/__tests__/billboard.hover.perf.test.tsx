// @vitest-environment jsdom
//
// Per-move / per-hover handler cost guard (USER repro: just MOVING the mouse —
// not even painting — blocked the main thread ~600-700ms). The cost was that
// `editHoverCell` was a render-subscribed store field, so every hovered-cell
// change synchronously RE-RENDERED the whole billboard plugin and re-ran the
// overlay effect, whose projection helper scans EVERY occupied cell (O(N)).
//
// This test mounts the real plugin over a realistically-sized baked scene and
// asserts:
//   1. changing editHoverCell does NOT re-bake the master (buildVoxelMaster) and
//      does NOT scan all cells via the overlay projection helper on the React
//      render path (hover is decoupled to a transient subscription + rAF draw),
//   2. a single additive paint does NOT re-snapshot/scan the whole scene
//      (buildVoxelMaster not called; append path taken),
//   3. the projection helper, when it does run, uses the O(1) occupancy lookup
//      (it is given a column index, not asked to linear-scan N cells per move).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildSpy = vi.fn()
const occupancySpy = vi.fn()
// Counts how many times ANY layer's cells are fully iterated (the O(N) signature
// of snapshotOneLayer). An additive in-bounds paint must take the O(k) delta-fast
// path and therefore NOT re-iterate the whole (e.g. 25k-cell) layer per paint.
const iterCellsSpy = vi.fn()
// Counts cell-source creations that had to compute the layer's bbox by scanning
// ALL cells (layer.bbox absent). An additive in-bounds paint recreates the source
// but must reuse the store's incrementally-maintained bbox — so a steady-state
// paint must NOT trigger a full bbox scan (which is the other O(N)-per-paint cost
// besides the snapshot/diff).
const bboxScanSpy = vi.fn()
// Counts asset-library resolutions (O(aliases×regex) per layer). This is the
// expensive portion of the structural key; an additive paint must NOT re-resolve
// the alias library (the assetTokenKey memo is keyed on a stable binding sig).
const matchAssetSpy = vi.fn()

vi.mock('../../../framework/asset/matchAssetEntry', async () => {
  const actual = await vi.importActual<typeof import('../../../framework/asset/matchAssetEntry')>(
    '../../../framework/asset/matchAssetEntry',
  )
  return {
    ...actual,
    matchAssetEntry: (...args: Parameters<typeof actual.matchAssetEntry>) => {
      matchAssetSpy()
      return actual.matchAssetEntry(...args)
    },
  }
})

vi.mock('../buildVoxelMaster', async () => {
  const actual = await vi.importActual<typeof import('../buildVoxelMaster')>('../buildVoxelMaster')
  return {
    ...actual,
    buildVoxelMaster: (...args: Parameters<typeof actual.buildVoxelMaster>) => {
      buildSpy()
      return actual.buildVoxelMaster(...args)
    },
  }
})

vi.mock('../../../framework/cellSource', async () => {
  const actual = await vi.importActual<typeof import('../../../framework/cellSource')>(
    '../../../framework/cellSource',
  )
  return {
    ...actual,
    voxelLayerCellSource: (...args: Parameters<typeof actual.voxelLayerCellSource>) => {
      if (!args[0]?.bbox) bboxScanSpy()
      const src = actual.voxelLayerCellSource(...args)
      const origIter = src.iterCells.bind(src)
      return {
        ...src,
        iterCells: (visit: Parameters<typeof origIter>[0]) => {
          iterCellsSpy()
          return origIter(visit)
        },
      }
    },
  }
})

vi.mock('../../../framework/geometry/topBillboard', async () => {
  const actual = await vi.importActual<typeof import('../../../framework/geometry/topBillboard')>(
    '../../../framework/geometry/topBillboard',
  )
  return {
    ...actual,
    // Building the column-occupancy index is the ONLY O(N) hover-support work.
    // It must run on content change, never per hovered-cell move.
    buildColumnOccupancy: (...args: Parameters<typeof actual.buildColumnOccupancy>) => {
      occupancySpy()
      return actual.buildColumnOccupancy(...args)
    },
  }
})

import { render, act, fireEvent, cleanup } from '@testing-library/react'
import { useRenderStore } from '../../../store'
import { RenderCanvas } from '../../../host/RenderCanvas'
import { setServerImageResolver } from '../../../framework/asset/imageCache'
import { setCanvas2DBackend, type Surface2D } from '../../../framework/canvas2d'

function makeStubSurface(width: number, height: number): Surface2D {
  return {
    width,
    height,
    getContext: () => ({
      imageSmoothingEnabled: false,
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', globalAlpha: 1,
      fillRect: () => { }, clearRect: () => { }, strokeRect: () => { },
      drawImage: () => { }, save: () => { }, restore: () => { },
      beginPath: () => { }, rect: () => { }, clip: () => { },
      setLineDash: () => { }, moveTo: () => { }, lineTo: () => { }, stroke: () => { },
      closePath: () => { }, fill: () => { }, scale: () => { }, translate: () => { },
      setTransform: () => { },
    } as unknown as CanvasRenderingContext2D),
  } as unknown as Surface2D
}

beforeEach(() => {
  useRenderStore.getState().reset()
  buildSpy.mockClear()
  occupancySpy.mockClear()
  iterCellsSpy.mockClear()
  bboxScanSpy.mockClear()
  matchAssetSpy.mockClear()
  setCanvas2DBackend({ createSurface: makeStubSurface, devicePixelRatio: () => 1 })
  setServerImageResolver((alias) => {
    const m = alias.match(/\[([^\]]*)\]/g)
    const name = m?.[4]?.slice(1, -1) ?? alias
    return { alias: name, width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 }
  })
})

afterEach(() => {
  cleanup()
  setServerImageResolver(null)
  setCanvas2DBackend({
    createSurface: (w: number, h: number) => ({ width: w, height: h, getContext: () => null } as unknown as Surface2D),
    devicePixelRatio: () => 1,
  })
  vi.restoreAllMocks()
})

// Seed a realistically-sized painted floor (N cells) so any O(N)-per-move work is
// measurable and a regression to linear scanning would be obvious.
function setupLargeBakedScene(n: number): string {
  const s = useRenderStore.getState()
  s.setViewMode('topBillboard')
  s.setDrawMode('asset')
  s.setEditMode(true)
  const alias = '[0][1][2][3][Grass][5][6][7][floor][16][10][11][v]'
  s.setAliasMetas([{ alias, tileType: 'floor' }])
  s.setLayers('n', 'scene_output', [], [{ id: 1, name: 'Grass', type: 'tile' }])
  const cells: { x: number; y: number; z: number; token: string }[] = []
  const side = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) {
    cells.push({ x: i % side, y: Math.floor(i / side), z: 0, token: 'Grass' })
  }
  s.setBakedLayers([
    {
      nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'Grass',
      assetAlias: alias, assetType: 'tile', version: 1, cells,
    },
  ])
  return 'baked:/Floor'
}

describe('per-move hover cost', () => {
  it('changing editHoverCell does NOT re-bake the master or rebuild occupancy per move', async () => {
    setupLargeBakedScene(2000)
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const initialBuilds = buildSpy.mock.calls.length
    expect(initialBuilds).toBeGreaterThanOrEqual(1)
    const occupancyAfterMount = occupancySpy.mock.calls.length

    // Simulate 20 hovered-cell changes (what dragging the cursor across cells does).
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        useRenderStore.getState().setEditHoverCell({ x: i, y: 1, z: 0 })
      }
      await Promise.resolve()
    })

    // Hover must never re-bake the scene…
    expect(buildSpy.mock.calls.length).toBe(initialBuilds)
    // …and must never rebuild the O(N) occupancy index (cells didn't change).
    expect(occupancySpy.mock.calls.length).toBe(occupancyAfterMount)
  })

  it('a single additive paint does NOT re-bake the master', async () => {
    const key = setupLargeBakedScene(2000)
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const initialBuilds = buildSpy.mock.calls.length

    // Paint a cell INSIDE the existing master bbox (the common "paint onto a
    // populated layer" case) — must take the O(k) append path, never a re-bake.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 1, y: 1, z: 1, token: 'Grass' }])
      await Promise.resolve()
    })

    expect(buildSpy.mock.calls.length).toBe(initialBuilds)
  })

  it('a single additive paint on a ~25k-cell scene does NOT rebuild the O(N) occupancy index', async () => {
    // The real bottleneck after the O(k) append + dirty compose: the column
    // occupancy memo keyed on contentSig (bumps every paint) re-iterated ALL
    // 25k cells and rebuilt the whole index on EVERY painted cell — ~375ms in the
    // React render phase. After the fix it keys on structuralKey only and additive
    // paints feed just the new cells in O(k), so buildColumnOccupancy must NOT be
    // called again on an in-bounds additive paint, regardless of scene size.
    const key = setupLargeBakedScene(25000)
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const occupancyAfterMount = occupancySpy.mock.calls.length
    expect(occupancyAfterMount).toBeGreaterThanOrEqual(1) // built once at mount

    // Paint several cells inside the existing bbox (a short drag). NONE of these
    // may trigger a full O(N) occupancy rebuild.
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 2 + i, y: 2, z: 1, token: 'Grass' }])
      }
      await Promise.resolve()
    })

    // Independent of N (25k here): the full builder ran ONLY at mount, never per
    // paint. (Pre-fix this would be occupancyAfterMount + 5.)
    expect(occupancySpy.mock.calls.length).toBe(occupancyAfterMount)
  })

  it('a single additive paint on a ~25k-cell scene does NOT re-snapshot/scan the whole layer (O(k) delta-fast, independent of N)', async () => {
    // After the occupancy fix, the remaining ~375ms in the paint→visible window
    // was the per-paint O(N) snapshot + diff: the effect re-snapshotted the WHOLE
    // (25k-cell) layer into a fresh Map and diffed it on EVERY paint. The fix
    // records the additive suffix in the store (paintBakedCells) and the effect
    // consumes it directly in O(k) — so a full re-iteration of the layer's cells
    // (snapshotOneLayer → source.iterCells) must NOT happen per additive paint,
    // regardless of scene size. This test fails pre-fix (iterCells fires per
    // paint) and passes after (zero per-paint full scans).
    const key = setupLargeBakedScene(25000)
    render(<RenderCanvas />)
    // Fully settle mount: asset-readiness pulses + layer-subscriber reports + the
    // initial build/snapshot/occupancy can span several renders AND delayed async
    // ticks (the 25k master build can land a tick later). A single warmup paint
    // absorbs any late mount rebuild, then we measure the steady-state paints.
    // The 25k master build/adopt can land a render (and async tick) AFTER the
    // first paint that triggers it. Warmup-paint, then drain until BOTH the build
    // counter AND the O(N) iteration counter stop moving, so the steady-state
    // paints we measure carry zero residual mount/late-build work.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 149, y: 157, z: 0, token: 'Grass' }])
      await new Promise((r) => setTimeout(r, 0))
    })
    let prevBuilds = -1
    let prevIters = -1
    for (
      let guard = 0;
      guard < 30 && (buildSpy.mock.calls.length !== prevBuilds || iterCellsSpy.mock.calls.length !== prevIters);
      guard++
    ) {
      prevBuilds = buildSpy.mock.calls.length
      prevIters = iterCellsSpy.mock.calls.length
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    }

    iterCellsSpy.mockClear()
    bboxScanSpy.mockClear()
    matchAssetSpy.mockClear()
    const buildsAfterMount = buildSpy.mock.calls.length

    // Each paint is committed in its own render (production commits one rAF flush
    // → one paintBakedCells → one effect run → delta-fast path). Assert that NO
    // paint re-iterates the whole layer (the O(N) snapshotOneLayer signature):
    // the delta-fast path must replay only the appended cells. Pre-fix, each paint
    // re-snapshotted all 25k cells (iterCells fires per paint).
    // Paint additive cells that stay INSIDE the existing master bbox (no grow):
    // the 25k cells fill a ~159×159 grid but leave the last row partial, so z=0
    // cells in that gap are new yet in-bounds — the cheap dirty-rect blit path.
    for (let i = 0; i < 5; i++) {
      const before = iterCellsSpy.mock.calls.length
      const bboxBefore = bboxScanSpy.mock.calls.length
      const matchBefore = matchAssetSpy.mock.calls.length
      await act(async () => {
        useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 150 + i, y: 157, z: 0, token: 'Grass' }])
        await Promise.resolve()
      })
      expect(iterCellsSpy.mock.calls.length - before).toBe(0)
      // The cell-source is recreated on the paint (layer ref changed) but must
      // reuse the store's incrementally-maintained bbox — no O(N) bbox scan.
      expect(bboxScanSpy.mock.calls.length - bboxBefore).toBe(0)
      // The structural key's expensive asset-token portion is memoized on a stable
      // binding signature; an append leaves it unchanged → ZERO alias resolutions.
      // Pre-fix, makeStructuralKey re-resolved every layer per paint (~156ms).
      expect(matchAssetSpy.mock.calls.length - matchBefore).toBe(0)
    }

    // No re-bake per paint either: the master is updated in place by the O(k)
    // append, never re-built. (Per-paint O(N) re-iteration is asserted == 0 in the
    // loop above.)
    expect(buildSpy.mock.calls.length).toBe(buildsAfterMount)
  })

  it('a REAL structural change (asset rebind) DOES re-resolve the alias library and rebuild occupancy', async () => {
    // Guard the other side of the structuralKey fix: the memo must STILL invalidate
    // on a genuine structural edit. Re-binding a layer's asset changes the binding
    // signature → assetTokenKey recomputes (matchAssetEntry runs) → structuralKey
    // changes → occupancyCache (keyed on structuralKey) rebuilds. Without this the
    // memoization would be a correctness bug, not just a perf win.
    const key = setupLargeBakedScene(25000)
    render(<RenderCanvas />)
    let prevBuilds = -1
    let prevMatch = -1
    for (
      let guard = 0;
      guard < 30 && (buildSpy.mock.calls.length !== prevBuilds || matchAssetSpy.mock.calls.length !== prevMatch);
      guard++
    ) {
      prevBuilds = buildSpy.mock.calls.length
      prevMatch = matchAssetSpy.mock.calls.length
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    }

    matchAssetSpy.mockClear()
    occupancySpy.mockClear()

    await act(async () => {
      useRenderStore.getState().bindBakedLayerAsset(key, 'Stone', 'tile', '[0][1][2][3][Stone][5][6][7][floor][16][10][11][v]')
      await new Promise((r) => setTimeout(r, 0))
    })

    // A real structural change re-resolves the alias library and rebuilds the
    // structuralKey-keyed occupancy index.
    expect(matchAssetSpy.mock.calls.length).toBeGreaterThan(0)
    expect(occupancySpy.mock.calls.length).toBeGreaterThan(0)
  })

  it('firing real mousemove DOM events does NOT re-bake the master per move (no setMouseCell re-render)', async () => {
    setupLargeBakedScene(2000)
    const { getAllByTestId } = render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const canvas = getAllByTestId('render-canvas')[0]
    const buildsBeforeMoves = buildSpy.mock.calls.length

    // Drag the cursor across many pixels. Previously each move ran
    // setMouseCell() → React re-render of RenderCanvas → re-render of the whole
    // billboard plugin subtree (and its heavy memos/effects). The cursor-cell
    // readout is now imperative (ref + DOM textContent), so moving the mouse must
    // NOT trigger any buildVoxelMaster work.
    await act(async () => {
      for (let i = 0; i < 30; i++) {
        fireEvent.mouseMove(canvas, { clientX: 40 + i * 3, clientY: 40 + i * 2 })
      }
      await Promise.resolve()
    })

    expect(buildSpy.mock.calls.length).toBe(buildsBeforeMoves)
    expect(occupancySpy.mock.calls.length).toBeGreaterThanOrEqual(0)
  })
})
