/**
 * spline_sample: control point2d[] → dense centerline + tangents + widths.
 * The curve is the authoring value. Raster masks stay optional downstream.
 */

import { makePoint2D } from '../../../../vendor/dist/shared/types/index.js'
import { parsePoint2dList } from '../../../../vendor/shared/types/scene/points.js'
import {
  cumulativeArc,
  dedupeControlPoints,
  parseNumberList,
  resolveWidths,
  sampleOpenSpline,
  tangentsOfPolyline,
} from '../../../../vendor/shared/types/scene/spline.js'

export function splineSample(input: Record<string, unknown>): Record<string, unknown> {
  const control = dedupeControlPoints(parsePoint2dList(input.points).map(([x, y]) => [x, y]))
  if (control.length < 2) {
    return { error: 'points must contain at least 2 distinct control points', points: [], tangents: [], yaw: [], widths: [], count: 0 }
  }
  const tension = typeof input.tension === 'number' ? Math.max(0, Math.min(1, input.tension)) : 0
  const roundness = typeof input.roundness === 'number' ? Math.max(0, Math.min(2.5, input.roundness)) : 1.3
  const samplesPerSegment = typeof input.samplesPerSegment === 'number'
    ? Math.max(1, Math.floor(input.samplesPerSegment))
    : 24
  const roadWidth = typeof input.roadWidth === 'number' && input.roadWidth > 0 ? input.roadWidth : 3
  const flareStart = typeof input.flareStart === 'number' && input.flareStart > 0 ? input.flareStart : 0

  const sampled = sampleOpenSpline(control, samplesPerSegment, tension, roundness)
  const tangents = tangentsOfPolyline(sampled)
  const arcAt = cumulativeArc(sampled)
  const widths = resolveWidths(
    sampled.length,
    arcAt[arcAt.length - 1] ?? 0,
    arcAt,
    roadWidth,
    parseNumberList(input.widths),
    flareStart,
  )
  const yaw = tangents.map(([tx, ty]) => Math.atan2(ty, tx))

  return {
    points: sampled.map(([x, y]) => makePoint2D(x, y)),
    tangents: tangents.map(([x, y]) => makePoint2D(x, y)),
    yaw,
    widths,
    count: sampled.length,
    length: arcAt[arcAt.length - 1] ?? 0,
  }
}
