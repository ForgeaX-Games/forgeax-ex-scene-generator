// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setCanvas2DBackend } from '../../framework/canvas2d'
import { composeDirtyRect } from './compose'
import type { VoxelBbox } from '../../framework/geometry/topBillboard'

// Records drawImage calls so we can assert the dirty-rect compose blits ONLY the
// small changed sub-rect of the master (9-arg drawImage with src = dirty size),
// not the entire — potentially enormous — master canvas every paint.
interface DrawImageCall { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number; full: boolean }
let drawCalls: DrawImageCall[] = []

function recordingCanvas(bufW: number, bufH: number) {
  const ctx = {
    imageSmoothingEnabled: false,
    fillStyle: '',
    setTransform: () => {},
    scale: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    fillRect: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    drawImage: (...a: unknown[]) => {
      if (a.length >= 9) {
        drawCalls.push({ sx: a[1] as number, sy: a[2] as number, sw: a[3] as number, sh: a[4] as number, dw: a[7] as number, dh: a[8] as number, full: false })
      } else {
        drawCalls.push({ sx: 0, sy: 0, sw: -1, sh: -1, dw: a[3] as number, dh: a[4] as number, full: true })
      }
    },
  }
  return {
    width: bufW,
    height: bufH,
    style: {} as Record<string, string>,
    parentElement: { getBoundingClientRect: () => ({ width: 400, height: 300 }) },
    getBoundingClientRect: () => ({ width: 400, height: 300 }),
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
}

function masterSurface(w: number, h: number) {
  return { width: w, height: h, getContext: () => null } as never
}

beforeEach(() => {
  drawCalls = []
  // composeFrame/composeDirtyRect read devicePixelRatio() from the backend.
  setCanvas2DBackend({ createSurface: (w, h) => masterSurface(w, h), devicePixelRatio: () => 1 })
  // window.getComputedStyle is used by readCanvasBg.
  ;(globalThis as { window?: unknown }).window = {
    getComputedStyle: () => ({ backgroundColor: '#000' }),
  }
})

afterEach(() => {
  setCanvas2DBackend({
    createSurface: (w, h) => masterSurface(w, h),
    devicePixelRatio: () => 1,
  })
  delete (globalThis as { window?: unknown }).window
})

function bbox(cols: number, rows: number): VoxelBbox {
  return { cols, rows, worldOffsetX: 0, worldOffsetY: 0 }
}

describe('composeDirtyRect (incremental visible-canvas blit)', () => {
  it('blits ONLY the dirty sub-rect, not the whole master (src args = dirty size)', () => {
    // 25k-cell-scale master: a huge canvas. A paint changed a tiny 48×48 px rect.
    const masterW = 4000, masterH = 3000
    const canvas = recordingCanvas(400, 300)
    const ok = composeDirtyRect(
      {
        canvas,
        voxelMaster: { canvas: masterSurface(masterW, masterH), bbox: bbox(500, 375) },
        maxRows: 375, maxCols: 500,
        cellSize: 8,
        offsetX: 0, offsetY: 0, scale: 1,
        showGrid: false,
      },
      { x0: 1000, y0: 800, x1: 1048, y1: 848 }, // 48×48 dirty rect
    )
    expect(ok).toBe(true)
    const blits = drawCalls.filter((c) => !c.full)
    expect(blits).toHaveLength(1)
    // Source rect equals the dirty rect, NOT the full master.
    expect(blits[0].sw).toBe(48)
    expect(blits[0].sh).toBe(48)
    expect(blits[0].sw).toBeLessThan(masterW)
  })

  it('blit work is INDEPENDENT of master size (same dirty rect ⇒ same source area)', () => {
    const dirty = { x0: 100, y0: 100, x1: 164, y1: 164 } // 64×64
    const srcAreas: number[] = []
    for (const [mw, mh, cols, rows] of [
      [800, 600, 100, 75],
      [4000, 3000, 500, 375],
      [8000, 6000, 1000, 750],
    ] as Array<[number, number, number, number]>) {
      drawCalls = []
      const canvas = recordingCanvas(400, 300)
      const ok = composeDirtyRect(
        {
          canvas,
          voxelMaster: { canvas: masterSurface(mw, mh), bbox: bbox(cols, rows) },
          maxRows: rows, maxCols: cols,
          cellSize: 8, offsetX: 0, offsetY: 0, scale: 1, showGrid: false,
        },
        dirty,
      )
      expect(ok).toBe(true)
      const blit = drawCalls.find((c) => !c.full)!
      srcAreas.push(blit.sw * blit.sh)
    }
    // The source area blitted is the SAME (64×64) regardless of a 10× master size.
    expect(new Set(srcAreas).size).toBe(1)
    expect(srcAreas[0]).toBe(64 * 64)
  })

  it('falls back (returns false) when the canvas buffer size changed (needs full repaint)', () => {
    const canvas = recordingCanvas(123, 45) // buffer != cssW*dpr (400×300)
    const ok = composeDirtyRect(
      {
        canvas,
        voxelMaster: { canvas: masterSurface(4000, 3000), bbox: bbox(500, 375) },
        maxRows: 375, maxCols: 500, cellSize: 8, offsetX: 0, offsetY: 0, scale: 1, showGrid: false,
      },
      { x0: 0, y0: 0, x1: 48, y1: 48 },
    )
    expect(ok).toBe(false)
  })
})
