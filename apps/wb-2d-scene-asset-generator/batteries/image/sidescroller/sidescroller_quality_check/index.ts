import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function luminance(src: Uint8Array, idx: number): number {
  return (src[idx] + src[idx + 1] + src[idx + 2]) / 3
}

function rowMean(src: Uint8Array, w: number, y: number): number {
  let sum = 0
  for (let x = 0; x < w; x++) sum += luminance(src, (y * w + x) * 4)
  return sum / w
}

function colDelta(src: Uint8Array, w: number, h: number, x: number): number {
  if (x <= 0 || x >= w) return 0
  let total = 0
  for (let y = 0; y < h; y++) {
    const a = (y * w + x - 1) * 4
    const b = (y * w + x) * 4
    total += Math.abs(src[a] - src[b]) + Math.abs(src[a + 1] - src[b + 1]) + Math.abs(src[a + 2] - src[b + 2])
  }
  return total / (h * 3)
}

function edgeVariance(src: Uint8Array, w: number, h: number): number {
  const samples: number[] = []
  for (let x = 0; x < w; x++) {
    samples.push(luminance(src, x * 4))
    samples.push(luminance(src, ((h - 1) * w + x) * 4))
  }
  const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length)
  return samples.reduce((a, b) => a + Math.abs(b - mean), 0) / Math.max(1, samples.length)
}

export function sidescrollerQualityCheck(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Record<string, unknown> {
  const borderThreshold = typeof input.border_threshold === 'number' ? input.border_threshold : 8
  const seamThreshold = typeof input.seam_threshold === 'number' ? input.seam_threshold : 38
  let report: Record<string, unknown> = {}
  const res = processImage(input, ctx, 'sidescroller_quality_check', (img: DecodedImage) => {
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const top = rowMean(src, img.width, 0)
    const bottom = rowMean(src, img.width, img.height - 1)
    let maxSeam = 0
    for (let x = 1; x < img.width; x++) maxSeam = Math.max(maxSeam, colDelta(src, img.width, img.height, x))
    const borderPadding = Math.min(top, bottom) < 15 || edgeVariance(src, img.width, img.height) < borderThreshold
    const continuity = maxSeam <= seamThreshold
    const action = borderPadding || !continuity ? 'regenerate' : 'proceed'
    report = {
      action,
      score: Math.max(0, Math.round(100 - maxSeam)),
      checks: {
        border_padding: !borderPadding,
        continuity,
      },
      metrics: {
        top_row_mean: Number(top.toFixed(2)),
        bottom_row_mean: Number(bottom.toFixed(2)),
        edge_variance: Number(edgeVariance(src, img.width, img.height).toFixed(2)),
        max_vertical_delta: Number(maxSeam.toFixed(2)),
      },
      feedback: action === 'proceed' ? 'quality checks passed' : 'regenerate with no black bars, no borders, and no vertical panel stitching',
    }
    return { width: img.width, height: img.height, data: img.data }
  }, { suffix: '_quality' })
  return {
    image: res.image,
    action: String(report.action ?? (res.error ? 'regenerate' : 'proceed')),
    score: typeof report.score === 'number' ? report.score : 0,
    report: JSON.stringify(report),
    error: res.error,
  }
}
