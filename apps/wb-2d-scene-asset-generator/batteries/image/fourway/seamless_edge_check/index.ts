import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function avgEdgeDelta(src: Uint8Array, w: number, h: number, edge: 'lr' | 'tb'): number {
  let total = 0
  let count = 0
  if (edge === 'lr') {
    for (let y = 0; y < h; y++) {
      const li = y * w * 4
      const ri = (y * w + w - 1) * 4
      total += Math.abs(src[li] - src[ri]) + Math.abs(src[li + 1] - src[ri + 1]) + Math.abs(src[li + 2] - src[ri + 2])
      count += 3
    }
  } else {
    const bottom = (h - 1) * w * 4
    for (let x = 0; x < w; x++) {
      const ti = x * 4
      const bi = bottom + x * 4
      total += Math.abs(src[ti] - src[bi]) + Math.abs(src[ti + 1] - src[bi + 1]) + Math.abs(src[ti + 2] - src[bi + 2])
      count += 3
    }
  }
  return count > 0 ? total / count : 0
}

export function seamlessEdgeCheck(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Record<string, unknown> {
  const threshold = typeof input.threshold === 'number' ? input.threshold : 18
  let lr = 0
  let tb = 0
  const res = processImage(input, ctx, 'seamless_edge_check', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    lr = avgEdgeDelta(src, img.width, img.height, 'lr')
    tb = avgEdgeDelta(src, img.width, img.height, 'tb')
    return { width: img.width, height: img.height, data: img.data }
  }, { suffix: '_edgecheck' })
  const passed = !res.error && lr <= threshold && tb <= threshold
  const report = {
    left_right_max_delta: Number(lr.toFixed(2)),
    top_bottom_max_delta: Number(tb.toFixed(2)),
    threshold,
    passed,
  }
  return {
    image: res.image,
    left_right_max_delta: report.left_right_max_delta,
    top_bottom_max_delta: report.top_bottom_max_delta,
    passed,
    report: JSON.stringify(report),
    error: res.error,
  }
}
