// @vitest-environment jsdom
//
// Regression: painting while the canvas pans (paint-to-edge auto/middle-button
// pan, or wheel zoom mid-stroke) used to make the just-painted stroke VANISH
// until a refresh. Root cause: an additive paint advances `masterRef.current`
// in place (a brand-new master, often a grown NEW canvas) WITHOUT bumping
// structuralKey, so the React-state `voxelMaster` stays stale. A viewport change
// then re-rendered + full-recomposed the frame from that STALE state master,
// repainting the new cells away.
//
// This test mounts the real billboard plugin, paints an out-of-bbox cell (forces
// an incremental GROW → a fresh master object), then changes the viewport
// (panViewport2d) and asserts the resulting FULL composeFrame draws the LATEST
// master (the one the append produced), NOT a stale one — and that the pan did
// NOT trigger any buildVoxelMaster (viewport changes only re-send the frame).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const buildSpy = vi.fn()
// Records the master each compose call received, tagged by which path drew it.
const composeFullCalls: Array<{ master: unknown }> = []
const composeDirtyCalls: Array<{ master: unknown }> = []
// The most recent master object the incremental append returned (the truth the
// frame should reflect after a paint).
let lastAppendResult: unknown = null

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
      if (r) lastAppendResult = r
      return r
    },
  }
})

vi.mock('../compose', async () => {
  const actual = await vi.importActual<typeof import('../compose')>('../compose')
  return {
    ...actual,
    composeFrame: (args: Parameters<typeof actual.composeFrame>[0]) => {
      composeFullCalls.push({ master: args.voxelMaster })
      // Don't call through (jsdom has no real 2D context); we only need the args.
    },
    composeDirtyRect: (args: Parameters<typeof actual.composeDirtyRect>[0]) => {
      composeDirtyCalls.push({ master: args.voxelMaster })
      return true // pretend the partial blit succeeded
    },
  }
})

import { render, act } from '@testing-library/react'
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
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
      fillRect: () => { }, clearRect: () => { }, strokeRect: () => { },
      drawImage: () => { }, save: () => { }, restore: () => { },
      beginPath: () => { }, rect: () => { }, clip: () => { },
      setLineDash: () => { }, moveTo: () => { }, lineTo: () => { }, stroke: () => { },
      closePath: () => { }, fill: () => { },
    } as unknown as CanvasRenderingContext2D),
  } as unknown as Surface2D
}

// Pan/zoom no longer recomposes synchronously off a React render — it's driven
// by an imperative store subscription that coalesces to one redraw per rAF (see
// index.tsx's "Pan/zoom: imperative compose" block). Tests must install a
// controllable rAF queue and flush it explicitly, exactly like RenderCanvas's
// own installRafQueue() helper.
function installRafQueue(): () => void {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
    callbacks.push(cb)
    return callbacks.length
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return () => {
    const pending = callbacks.splice(0)
    for (const cb of pending) cb(performance.now())
  }
}

let flushRaf: () => void

beforeEach(() => {
  useRenderStore.getState().reset()
  buildSpy.mockClear()
  composeFullCalls.length = 0
  composeDirtyCalls.length = 0
  lastAppendResult = null
  setCanvas2DBackend({ createSurface: makeStubSurface, devicePixelRatio: () => 1 })
  setServerImageResolver((alias) => {
    const m = alias.match(/\[([^\]]*)\]/g)
    const name = m?.[4]?.slice(1, -1) ?? alias
    return { alias: name, width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 }
  })
  flushRaf = installRafQueue()
})

afterEach(() => {
  setServerImageResolver(null)
  setCanvas2DBackend({
    createSurface: (w: number, h: number) => ({ width: w, height: h, getContext: () => null } as unknown as Surface2D),
    devicePixelRatio: () => 1,
  })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setupBakedAssetLayer(): string {
  const s = useRenderStore.getState()
  s.setViewMode('topBillboard')
  s.setDrawMode('asset')
  const alias = '[0][1][2][3][Grass][5][6][7][floor][16][10][11][v]'
  s.setAliasMetas([{ alias, tileType: 'floor' }])
  s.setLayers('n', 'scene_output', [], [{ id: 1, name: 'Grass', type: 'tile' }])
  s.setBakedLayers([
    {
      nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'Grass', assetAlias: alias, assetType: 'tile', version: 1,
      cells: [0, 1, 3, 4].map((x) => ({ x, y: 0, z: 0, token: 'Grass' })),
    },
  ])
  return 'baked:/Floor'
}

describe('paint-then-pan: viewport change re-composes the LATEST master (paint must not vanish)', () => {
  it('a full compose triggered by a pan uses the incremental master, not a stale one', async () => {
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    const buildsAfterMount = buildSpy.mock.calls.length
    expect(buildsAfterMount).toBeGreaterThanOrEqual(1)

    // Paint an out-of-bbox cell → incremental GROW → a brand-new master object
    // (new canvas) lives in masterRef.current; the React-state voxelMaster stays
    // the pre-grow one. This is exactly the desync that made paint vanish on pan.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 40, y: 7, z: 0, token: 'Grass' }])
      await Promise.resolve()
    })
    expect(lastAppendResult).not.toBeNull()
    expect(buildSpy.mock.calls.length).toBe(buildsAfterMount) // append, not rebuild

    composeFullCalls.length = 0
    composeDirtyCalls.length = 0

    // Now PAN. This must re-render + full-compose the frame. Pre-fix it composed
    // the stale state master (dropping the x=40 cell); post-fix it composes the
    // latest masterRef.current (= the append result).
    await act(async () => {
      useRenderStore.getState().panViewport2d(13, -7)
      await Promise.resolve()
      flushRaf()
    })

    // The pan must NOT rebuild the surface (viewport only re-sends the frame).
    expect(buildSpy.mock.calls.length).toBe(buildsAfterMount)
    // A full compose ran for the pan…
    expect(composeFullCalls.length).toBeGreaterThanOrEqual(1)
    // …and EVERY full compose after the pan drew a master whose bbox spans the
    // just-painted out-of-bbox cell (x=40, y=7), so the stroke is present in the
    // recomposed frame — never a stale pre-grow master that would drop it.
    for (const call of composeFullCalls) {
      const m = call.master as { bbox: { worldOffsetX: number; worldOffsetY: number; cols: number; rows: number } } | null
      expect(m).not.toBeNull()
      expect(m!.bbox.worldOffsetX + m!.bbox.cols).toBeGreaterThan(40)
      expect(m!.bbox.worldOffsetY + m!.bbox.rows).toBeGreaterThan(7)
    }
  })

  it('the grid extent (maxRows/maxCols) tracks the grown master so the pan frame is aligned', async () => {
    const key = setupBakedAssetLayer()
    render(<RenderCanvas />)
    await act(async () => { await Promise.resolve() })

    // Grow far out so the bbox visibly expands; the recomposed pan frame must use
    // a master whose bbox COVERS the new cell (derived from masterRef), not the
    // stale pre-grow extent.
    await act(async () => {
      useRenderStore.getState().paintBakedCells(key, (prev) => [...prev, { x: 60, y: 12, z: 0, token: 'Grass' }])
      await Promise.resolve()
    })

    composeFullCalls.length = 0
    await act(async () => {
      useRenderStore.getState().panViewport2d(5, 5)
      await Promise.resolve()
      flushRaf()
    })

    // The pan recomposed using a master whose bbox spans the just-painted cell
    // (x=60, y=12) — proving the extent tracked the grown master, not a stale one.
    expect(composeFullCalls.length).toBeGreaterThanOrEqual(1)
    const panMaster = composeFullCalls[composeFullCalls.length - 1].master as { bbox: { worldOffsetX: number; worldOffsetY: number; cols: number; rows: number } } | null
    expect(panMaster).not.toBeNull()
    const bb = panMaster!.bbox
    expect(bb.worldOffsetX + bb.cols).toBeGreaterThan(60)
    expect(bb.worldOffsetY + bb.rows).toBeGreaterThan(12)
  })
})
