export interface OrthographicGuideArgs {
  cssW: number
  cssH: number
  cellSize: number
  offsetX: number
  offsetY: number
  scale: number
  originX: number
  originY: number
}

/** Draws viewport-spanning XY grid lines after the viewport transform is set. */
export function drawOrthographicGuides2d(
  ctx: CanvasRenderingContext2D,
  args: OrthographicGuideArgs,
): void {
  const { cssW, cssH, cellSize, offsetX, offsetY, scale, originX, originY } = args
  if (cellSize * scale < 4) return
  const cx = Math.round(cssW / 2)
  const cy = Math.round(cssH / 2)
  const left = (0 - cx - offsetX) / scale + cx
  const right = (cssW - cx - offsetX) / scale + cx
  const top = (0 - cy - offsetY) / scale + cy
  const bottom = (cssH - cy - offsetY) / scale + cy
  const colStart = Math.floor((left - originX) / cellSize)
  const colEnd = Math.ceil((right - originX) / cellSize)
  const rowStart = Math.floor((top - originY) / cellSize)
  const rowEnd = Math.ceil((bottom - originY) / cellSize)

  ctx.save()
  ctx.lineWidth = 1 / scale
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath()
  for (let col = colStart; col <= colEnd; col++) {
    const x = originX + col * cellSize
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
  }
  for (let row = rowStart; row <= rowEnd; row++) {
    const y = originY + row * cellSize
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
  }
  ctx.stroke()

  ctx.lineWidth = 1.5 / scale
  ctx.strokeStyle = 'rgba(120,170,255,0.35)'
  ctx.beginPath()
  ctx.moveTo(originX, top)
  ctx.lineTo(originX, bottom)
  ctx.moveTo(left, originY)
  ctx.lineTo(right, originY)
  ctx.stroke()
  ctx.restore()
}

export interface IsoGuideArgs {
  cssW: number
  cssH: number
  offsetX: number
  offsetY: number
  scale: number
  cellW: number
  cellH: number
}

/** Draws a z=0 XY lattice in the same dimetric projection as the Iso plugin. */
export function drawIsoGuides2d(ctx: CanvasRenderingContext2D, args: IsoGuideArgs): void {
  const { cssW, cssH, offsetX, offsetY, scale, cellW, cellH } = args
  if (Math.min(cellW / 2, cellH / 2) * scale < 3) return
  const cx = Math.round(cssW / 2)
  const cy = Math.round(cssH / 2)
  const sx0 = (0 - cx - offsetX) / scale
  const sx1 = (cssW - cx - offsetX) / scale
  const sy0 = (0 - cy - offsetY) / scale
  const sy1 = (cssH - cy - offsetY) / scale
  const corners = [
    [sx0, sy0], [sx1, sy0], [sx0, sy1], [sx1, sy1],
  ] as const
  const world = corners.map(([sx, sy]) => ({
    x: sx / cellW + sy / cellH,
    y: sy / cellH - sx / cellW,
  }))
  const minX = Math.floor(Math.min(...world.map((p) => p.x))) - 1
  const maxX = Math.ceil(Math.max(...world.map((p) => p.x))) + 1
  const minY = Math.floor(Math.min(...world.map((p) => p.y))) - 1
  const maxY = Math.ceil(Math.max(...world.map((p) => p.y))) + 1
  const project = (x: number, y: number): readonly [number, number] => [
    (x - y) * (cellW / 2),
    (x + y) * (cellH / 2),
  ]

  ctx.save()
  ctx.lineWidth = 1 / scale
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath()
  for (let x = minX; x <= maxX; x++) {
    const a = project(x, minY)
    const b = project(x, maxY)
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
  }
  for (let y = minY; y <= maxY; y++) {
    const a = project(minX, y)
    const b = project(maxX, y)
    ctx.moveTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
  }
  ctx.stroke()

  ctx.lineWidth = 1.5 / scale
  ctx.strokeStyle = 'rgba(120,170,255,0.4)'
  ctx.beginPath()
  const xAxisA = project(minX, 0)
  const xAxisB = project(maxX, 0)
  const yAxisA = project(0, minY)
  const yAxisB = project(0, maxY)
  ctx.moveTo(xAxisA[0], xAxisA[1])
  ctx.lineTo(xAxisB[0], xAxisB[1])
  ctx.moveTo(yAxisA[0], yAxisA[1])
  ctx.lineTo(yAxisB[0], yAxisB[1])
  ctx.stroke()
  ctx.restore()
}
