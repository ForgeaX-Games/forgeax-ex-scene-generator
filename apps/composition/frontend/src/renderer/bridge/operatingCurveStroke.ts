import { sampleOpenSpline } from '../../../../vendor/shared/types/scene/spline.js'

/** Dense enough that a cubic through three sites reads as a curve, not two chords. */
export const SPLINE_SAMPLES_PER_SEGMENT = 24

export function sampleOperatingSpline(
  points: Array<readonly [number, number]>,
  degree = 3,
): Array<[number, number]> {
  const pts = points.map(([x, y]) => [x, y] as [number, number])
  if (pts.length < 2) return pts
  if (degree < 2 || pts.length < 3) return pts
  return sampleOpenSpline(pts, SPLINE_SAMPLES_PER_SEGMENT, 0, 1.3)
}

export function splineStrokePoints(
  rec: { kind?: unknown; points?: unknown; degree?: unknown },
  controlPoints: Array<[number, number]>,
): Array<[number, number]> {
  if (rec.kind !== 'spline' && rec.kind !== 'spline3d') return controlPoints
  const degree = Number.isFinite(Number(rec.degree)) ? Math.max(1, Math.floor(Number(rec.degree))) : 3
  return sampleOperatingSpline(controlPoints, degree)
}

function lerpZAlongPolygon(controls: Array<readonly [number, number, number]>, x: number, y: number): number {
  if (controls.length === 0) return 0
  if (controls.length === 1) return controls[0]![2]
  let best = controls[0]![2]
  let bestD = Infinity
  for (let i = 1; i < controls.length; i++) {
    const a = controls[i - 1]!
    const b = controls[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 <= 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / len2))
    const px = a[0] + dx * t
    const py = a[1] + dy * t
    const d = Math.hypot(x - px, y - py)
    if (d < bestD) {
      bestD = d
      best = a[2] + (b[2] - a[2]) * t
    }
  }
  return best
}

export function splineStrokePoints3d(
  rec: { kind?: unknown; degree?: unknown },
  controlPoints: Array<[number, number, number]>,
): Array<[number, number, number]> {
  const xy = controlPoints.map(([x, y]) => [x, y] as [number, number])
  const sampled = splineStrokePoints(rec, xy)
  return sampled.map(([x, y]) => [x, y, lerpZAlongPolygon(controlPoints, x, y)])
}
