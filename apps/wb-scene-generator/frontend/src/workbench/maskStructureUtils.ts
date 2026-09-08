import { isDataTreeEntries, peelWireValue } from '@forgeax/node-runtime-react/editor'

function isGrid2D(val: unknown): val is number[][] {
  if (!Array.isArray(val) || val.length === 0) return false
  const first = val[0]
  return Array.isArray(first) && first.length >= 0 && (first.length === 0 || typeof first[0] === 'number')
}

function parseGridValue(val: unknown): number[][] | null {
  if (val === null || val === undefined) return null

  let parsed: unknown = val
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val)
    } catch {
      return null
    }
  }

  if (!isGrid2D(parsed)) return null
  return parsed
}

/**
 * Extract the first 2D grid from a wire-side port value.
 * Multi-branch / multi-item DataTree inputs only surface the first grid.
 */
export function extractGridFromWire(raw: unknown): number[][] | null {
  if (raw === undefined || raw === null) return null

  if (isDataTreeEntries(raw)) {
    const firstItem = raw[0]?.items?.[0]
    return firstItem !== undefined ? extractGridFromWire(firstItem) : null
  }

  const peeled = peelWireValue(raw)
  if (peeled !== raw) return extractGridFromWire(peeled)

  return parseGridValue(raw)
}

export function gridDimensions(grid: number[][]): { rows: number; cols: number } {
  const rows = grid.length
  const cols = rows > 0 ? Math.max(...grid.map((row) => row.length)) : 0
  return { rows, cols }
}

export function countNonZeroCells(grid: number[][]): number {
  let count = 0
  for (const row of grid) {
    for (const value of row) {
      if (value !== 0) count += 1
    }
  }
  return count
}

export function drawMaskDots(canvas: HTMLCanvasElement, grid: number[][], cssWidth: number, cssHeight: number): void {
  const rows = grid.length
  const cols = gridDimensions(grid).cols
  if (rows === 0 || cols === 0 || cssWidth <= 0 || cssHeight <= 0) return

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#050608'
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  const cellW = cssWidth / cols
  const cellH = cssHeight / rows
  const radius = Math.max(1, Math.min(cellW, cellH) * 0.32)

  ctx.fillStyle = '#f8fafc'
  for (let row = 0; row < rows; row += 1) {
    const line = grid[row] ?? []
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === 0) continue
      const cx = col * cellW + cellW / 2
      const cy = row * cellH + cellH / 2
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
