/**
 * Open centripetal cubic spline used by spline_sample and polyline_road_spline.
 * The curve passes through every control point. This is a value (point2d[]),
 * not a new curves schema.
 */

export type Vec2 = [number, number]

export function dedupeControlPoints(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue
    out.push(p)
  }
  return out
}

function centripetalKnots(pts: Vec2[]): number[] {
  const t = [0]
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]![0] - pts[i - 1]![0]
    const dy = pts[i]![1] - pts[i - 1]![1]
    t.push(t[i - 1]! + Math.max(1e-6, Math.sqrt(Math.hypot(dx, dy))))
  }
  return t
}

function secondDerivatives(t: number[], y: number[]): number[] {
  const n = t.length
  const sub = new Array<number>(n).fill(0)
  const diag = new Array<number>(n).fill(0)
  const sup = new Array<number>(n).fill(0)
  const rhs = new Array<number>(n).fill(0)
  diag[0] = 1
  diag[n - 1] = 1
  for (let i = 1; i < n - 1; i++) {
    const h0 = t[i]! - t[i - 1]!
    const h1 = t[i + 1]! - t[i]!
    sub[i] = h0
    diag[i] = 2 * (h0 + h1)
    sup[i] = h1
    rhs[i] = 6 * ((y[i + 1]! - y[i]!) / h1 - (y[i]! - y[i - 1]!) / h0)
  }
  for (let i = 1; i < n; i++) {
    const f = sub[i]! / diag[i - 1]!
    diag[i] -= f * sup[i - 1]!
    rhs[i] -= f * rhs[i - 1]!
  }
  const y2 = new Array<number>(n).fill(0)
  y2[n - 1] = rhs[n - 1]! / diag[n - 1]!
  for (let i = n - 2; i >= 0; i--) y2[i] = (rhs[i]! - sup[i]! * y2[i + 1]!) / diag[i]!
  return y2
}

function firstDerivatives(t: number[], y: number[], y2: number[]): number[] {
  const n = t.length
  const d = new Array<number>(n).fill(0)
  for (let i = 0; i < n - 1; i++) {
    const h = t[i + 1]! - t[i]!
    d[i] = (y[i + 1]! - y[i]!) / h - (h * (2 * y2[i]! + y2[i + 1]!)) / 6
  }
  const hLast = t[n - 1]! - t[n - 2]!
  d[n - 1] = (y[n - 1]! - y[n - 2]!) / hLast + (hLast * (y2[n - 2]! + 2 * y2[n - 1]!)) / 6
  return d
}

export function sampleOpenSpline(
  pts: Vec2[],
  samplesPerSegment: number,
  tension: number,
  roundness: number,
): Vec2[] {
  const n = pts.length
  if (n < 2) return pts.slice()
  if (n === 2) return [pts[0]!, pts[1]!]

  const t = centripetalKnots(pts)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const dx = firstDerivatives(t, xs, secondDerivatives(t, xs))
  const dy = firstDerivatives(t, ys, secondDerivatives(t, ys))

  const LOOP_GUARD = 2.5
  const gain = (1 - tension) * roundness
  const scale = new Array<number>(n).fill(gain)
  for (let i = 0; i < n; i++) {
    const speed = Math.hypot(dx[i]!, dy[i]!)
    if (speed <= 1e-9) continue
    let limit = Infinity
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= n - 1) continue
      const h = t[j + 1]! - t[j]!
      const chord = Math.hypot(xs[j + 1]! - xs[j]!, ys[j + 1]! - ys[j]!)
      limit = Math.min(limit, (LOOP_GUARD * chord) / (h * speed))
    }
    scale[i] = Math.min(gain, limit)
  }

  const result: Vec2[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = t[i + 1]! - t[i]!
    const m0x = h * dx[i]! * scale[i]!
    const m0y = h * dy[i]! * scale[i]!
    const m1x = h * dx[i + 1]! * scale[i + 1]!
    const m1y = h * dy[i + 1]! * scale[i + 1]!
    for (let s = 0; s < samplesPerSegment; s++) {
      const u = s / samplesPerSegment
      const u2 = u * u
      const u3 = u2 * u
      const h00 = 2 * u3 - 3 * u2 + 1
      const h10 = u3 - 2 * u2 + u
      const h01 = -2 * u3 + 3 * u2
      const h11 = u3 - u2
      result.push([
        h00 * xs[i]! + h10 * m0x + h01 * xs[i + 1]! + h11 * m1x,
        h00 * ys[i]! + h10 * m0y + h01 * ys[i + 1]! + h11 * m1y,
      ])
    }
  }
  result.push(pts[n - 1]!)
  return result
}

export function tangentsOfPolyline(pts: Vec2[]): Vec2[] {
  const n = pts.length
  if (n === 0) return []
  if (n === 1) return [[1, 0]]
  return pts.map((p, i) => {
    const a = i === 0 ? p : pts[i - 1]!
    const b = i === n - 1 ? p : pts[i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [dx / len, dy / len] as Vec2
  })
}

export function polylineArcLengths(pts: Vec2[]): { lengths: number[]; total: number } {
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1])
    lengths.push(len)
    total += len
  }
  return { lengths, total }
}

export function parseNumberList(raw: unknown): number[] {
  if (raw == null) return []
  let list: unknown = raw
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  if (!Array.isArray(list)) {
    const n = Number(list)
    return Number.isFinite(n) ? [n] : []
  }
  if (list.length === 1 && Array.isArray(list[0])) list = list[0]
  return (list as unknown[])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0)
}

/**
 * Full width at each sample. Broadcasts roadWidth, or interpolates a shorter
 * widths[] along arc length. flareStart adds extra width on the first 18% (村口).
 */
export function resolveWidths(
  sampleCount: number,
  arcTotal: number,
  arcAt: readonly number[],
  roadWidth: number,
  widths: readonly number[],
  flareStart = 0,
): number[] {
  const base = roadWidth > 0 ? roadWidth : 3
  const out = new Array<number>(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    let w = base
    if (widths.length === 1) {
      w = widths[0]!
    } else if (widths.length === sampleCount) {
      w = widths[i]!
    } else if (widths.length > 1 && arcTotal > 0) {
      const t = Math.max(0, Math.min(1, (arcAt[i] ?? 0) / arcTotal))
      const f = t * (widths.length - 1)
      const i0 = Math.min(widths.length - 2, Math.floor(f))
      const u = f - i0
      w = widths[i0]! * (1 - u) + widths[i0 + 1]! * u
    }
    if (flareStart > 0 && arcTotal > 0) {
      const t = Math.max(0, Math.min(1, (arcAt[i] ?? 0) / arcTotal))
      const gate = t < 0.18 ? 1 - t / 0.18 : 0
      w += flareStart * gate * gate * (3 - 2 * gate)
    }
    out[i] = Math.max(0.4, w)
  }
  return out
}

export function cumulativeArc(pts: Vec2[]): number[] {
  const at = [0]
  for (let i = 0; i < pts.length - 1; i++) {
    at.push(at[i]! + Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]))
  }
  return at
}
