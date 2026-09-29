import { diagnoseGeometry } from '../../../../../../packages/scene-authoring/src/types/operating.js'
import { buildGeometryMask } from '../../../../vendor/shared/types/scene/geometryMask.js'

function unwrapGeom(value: unknown, depth = 0): unknown {
  if (value == null || depth > 8 || typeof value !== 'object') return value
  const rec = value as { kind?: unknown; geometry?: unknown }
  if (typeof rec.kind === 'string') return rec
  if (rec.geometry !== undefined) return unwrapGeom(rec.geometry, depth + 1)
  return rec
}

function zerosLike(grid: number[][]): number[][] {
  return grid.map((row) => row.map(() => 0))
}

export function geometryMask(input: Record<string, unknown>): Record<string, unknown> {
  const built = buildGeometryMask(input)
  const geom = unwrapGeom(input.geometry)
  const kind = geom && typeof geom === 'object' ? String((geom as { kind?: unknown }).kind ?? '') : ''
  if (kind === 'mesh' || kind === 'voxel') {
    return {
      grid: built.grid,
      error: built.error ?? 'geometryMask burns operating Geometry only (point2d / plane / polyline / spline / polygon / network)',
      _warnings: built._warnings,
    }
  }
  const fault = diagnoseGeometry(geom)
  const warnings = [...built._warnings]
  if (fault) {
    warnings.push({ code: fault.code, message: fault.message })
    return { grid: zerosLike(built.grid), _warnings: warnings }
  }
  return {
    grid: built.grid,
    _warnings: warnings,
    ...(built.error ? { error: built.error } : {}),
  }
}
