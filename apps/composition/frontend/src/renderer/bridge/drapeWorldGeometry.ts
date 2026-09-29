import {
  sampleHeightfieldWorld,
  type Heightfield,
} from '../../../../vendor/shared/types/scene/heightfieldField.js'
import type { WorldCurveFrame, WorldPointFrame, WorldStrokePoint } from '../framework/worldFrame.js'

function sampleSurfaceZ(field: Heightfield, x: number, y: number): number | undefined {
  const z = sampleHeightfieldWorld(field, x, y)
  return z !== undefined && Number.isFinite(z) ? z : undefined
}

export function drapeStrokePoint(
  field: Heightfield,
  x: number,
  y: number,
): WorldStrokePoint {
  const z = sampleSurfaceZ(field, x, y)
  return z === undefined ? [x, y] : [x, y, z]
}

/** Lift operating strokes onto the last Heightfield. Authored 3D frames keep their Z. */
export function drapeWorldCurves(
  curves: WorldCurveFrame[],
  field: Heightfield | null | undefined,
): WorldCurveFrame[] {
  if (!field) return curves
  return curves.map((curve) => {
    if (curve.space === 'world3d') return curve
    return {
      ...curve,
      strokes: curve.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => drapeStrokePoint(field, point[0], point[1])),
      })),
      ...(curve.vertices
        ? { vertices: curve.vertices.map((point) => drapeStrokePoint(field, point[0], point[1])) }
        : {}),
    }
  })
}

/** Sit point2d X marks on the same surface as the draped strokes. point3d keeps authored Z. */
export function drapeWorldPoints(
  points: WorldPointFrame[],
  field: Heightfield | null | undefined,
): WorldPointFrame[] {
  if (!field) return points
  return points.map((point) => {
    if (point.space === 'world3d') return point
    const z = sampleSurfaceZ(field, point.x, point.y)
    return z === undefined ? point : { ...point, z }
  })
}
