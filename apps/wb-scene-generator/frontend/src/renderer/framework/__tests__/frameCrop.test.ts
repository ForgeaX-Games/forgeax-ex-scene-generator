import { describe, it, expect } from 'vitest'
import { findContentBox } from '../frameCrop'

type Rect = { x: number; y: number; w: number; h: number }

/**
 * RGBA buffer with an opaque white rect painted into a frame that is either
 * transparent (three.js modes) or filled with an opaque backdrop (2D modes).
 */
function frame(w: number, h: number, rect?: Rect, backdrop?: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  if (backdrop) {
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = backdrop[0]
      data[i * 4 + 1] = backdrop[1]
      data[i * 4 + 2] = backdrop[2]
      data[i * 4 + 3] = 255
    }
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y * w + x) * 4
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
        data[i + 3] = 255
      }
    }
  }
  return { width: w, height: h, data }
}

describe('findContentBox', () => {
  it('finds the bounding box of the non-transparent pixels', () => {
    expect(findContentBox(frame(40, 30, { x: 10, y: 5, w: 8, h: 6 })))
      .toEqual({ minX: 10, minY: 5, maxX: 17, maxY: 10 })
  })

  it('keeps padding inside the frame bounds', () => {
    expect(findContentBox(frame(40, 30, { x: 0, y: 0, w: 4, h: 4 }), { padding: 3 }))
      .toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 6 })
  })

  it('returns null for an entirely transparent frame', () => {
    expect(findContentBox(frame(40, 30))).toBeNull()
  })

  // The 2D modes paint an opaque backdrop over the whole frame, so alpha alone
  // would report content everywhere.
  it('treats the frame’s own opaque backdrop as empty', () => {
    expect(findContentBox(frame(40, 30, { x: 10, y: 5, w: 8, h: 6 }, [0, 0, 0])))
      .toEqual({ minX: 10, minY: 5, maxX: 17, maxY: 10 })
  })

  it('returns null when an opaque frame is nothing but backdrop', () => {
    expect(findContentBox(frame(40, 30, undefined, [17, 17, 17]))).toBeNull()
  })

  it('keeps the whole frame when content reaches a corner (backdrop undetectable)', () => {
    expect(findContentBox(frame(40, 30, { x: 0, y: 0, w: 20, h: 20 }, [0, 0, 0])))
      .toEqual({ minX: 0, minY: 0, maxX: 39, maxY: 29 })
  })
})
