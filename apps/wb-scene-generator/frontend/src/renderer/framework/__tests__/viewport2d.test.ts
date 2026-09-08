import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_VIEWPORT_2D,
  MAX_SCALE,
  panViewport,
  zoomViewportAtPoint,
  zoomViewportCentered,
  type Viewport2DState,
} from '../viewport2d'
import { SCENE_DEFAULT_VIEWPORT_2D, useRenderStore } from '../../store'

describe('viewport2d reducers', () => {
  it('panViewport increments and rounds the offset', () => {
    const vp = panViewport({ offsetX: 10, offsetY: 5, scale: 2 }, 4.4, -2.6)
    expect(vp).toEqual({ offsetX: 14, offsetY: 2, scale: 2 })
  })

  it('zoomViewportAtPoint keeps the world point under the cursor fixed (anchor)', () => {
    const cx = 200
    const cy = 150
    const mouseX = 240 // 40 px right of center
    const start: Viewport2DState = { ...DEFAULT_VIEWPORT_2D }
    // The world coord currently under the cursor (offset 0, scale 1).
    const worldUnderCursor = (mouseX - cx - start.offsetX) / start.scale + cx
    const next = zoomViewportAtPoint(start, { mouseX, mouseY: cy, cx, cy, deltaY: -1 })
    expect(next).not.toBeNull()
    // Zoomed in (scale grew), and the same world point still lands on the cursor.
    expect(next!.scale).toBeGreaterThan(start.scale)
    const screenX = (worldUnderCursor - cx) * next!.scale + cx + next!.offsetX
    expect(screenX).toBeCloseTo(mouseX, 0)
  })

  it('zoomViewportAtPoint quantizes to nice steps and ignores sub-threshold changes', () => {
    // From scale 1, a wheel-in step lands on 1.1 (magnitude 0.1, round(11)*0.1).
    const next = zoomViewportAtPoint({ ...DEFAULT_VIEWPORT_2D }, { mouseX: 0, mouseY: 0, cx: 0, cy: 0, deltaY: -1 })
    expect(next!.scale).toBeCloseTo(1.1, 5)
  })

  it('does not exceed MAX_SCALE and returns null when clamped (no further change)', () => {
    const atMax: Viewport2DState = { offsetX: 0, offsetY: 0, scale: MAX_SCALE }
    const next = zoomViewportAtPoint(atMax, { mouseX: 0, mouseY: 0, cx: 0, cy: 0, deltaY: -1 })
    expect(next).toBeNull()
  })

  it('zoomViewportCentered scales the offset proportionally (center anchor)', () => {
    const next = zoomViewportCentered({ offsetX: 100, offsetY: -50, scale: 1 }, 'in')
    expect(next).not.toBeNull()
    expect(next!.scale).toBeCloseTo(1.1, 5)
    expect(next!.offsetX).toBe(Math.round(100 * (next!.scale / 1)))
    expect(next!.offsetY).toBe(Math.round(-50 * (next!.scale / 1)))
  })
})

describe('store viewport actions', () => {
  beforeEach(() => useRenderStore.getState().reset())

  it('panViewport2d accumulates deltas; resetViewport2d restores the default', () => {
    useRenderStore.getState().panViewport2d(10, 20)
    useRenderStore.getState().panViewport2d(5, -4)
    expect(useRenderStore.getState().viewport2d).toEqual({ offsetX: 15, offsetY: 16, scale: 0.7 })
    useRenderStore.getState().resetViewport2d()
    expect(useRenderStore.getState().viewport2d).toEqual(SCENE_DEFAULT_VIEWPORT_2D)
  })
})
