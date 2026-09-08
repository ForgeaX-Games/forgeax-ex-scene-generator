import { describe, expect, it, vi } from 'vitest'
import { drawIsoGuides2d, drawOrthographicGuides2d } from './guides2d'

function recordingContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('2D view guides', () => {
  it('draws orthographic grid lines and two emphasized origin axes', () => {
    const ctx = recordingContext()
    drawOrthographicGuides2d(ctx, {
      cssW: 320,
      cssH: 200,
      cellSize: 8,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      originX: 160,
      originY: 100,
    })
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.lineTo).toHaveBeenCalled()
  })

  it('skips an orthographic grid when cells are too dense', () => {
    const ctx = recordingContext()
    drawOrthographicGuides2d(ctx, {
      cssW: 320,
      cssH: 200,
      cellSize: 8,
      offsetX: 0,
      offsetY: 0,
      scale: 0.1,
      originX: 160,
      originY: 100,
    })
    expect(ctx.beginPath).not.toHaveBeenCalled()
  })

  it('draws a projected z=0 lattice and XY axes for Iso', () => {
    const ctx = recordingContext()
    drawIsoGuides2d(ctx, {
      cssW: 320,
      cssH: 200,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      cellW: 16,
      cellH: 8,
    })
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.lineTo).toHaveBeenCalled()
  })
})
