import {
  makePlane,
  parseSpatialVector2,
  unwrapSpatialWireValue,
} from '../../../../vendor/shared/types/scene/spatial.js'

export function basePlane(input: Record<string, unknown>): Record<string, unknown> {
  const width = Number(unwrapSpatialWireValue(input.width) ?? 10)
  const height = Number(unwrapSpatialWireValue(input.height) ?? 10)
  const origin = parseSpatialVector2(
    input.origin ?? [unwrapSpatialWireValue(input.x) ?? 0, unwrapSpatialWireValue(input.y) ?? 0],
    [0, 0],
  )
  const z = Number(unwrapSpatialWireValue(input.z) ?? 0)
  if (![width, height, origin[0], origin[1], z].every(Number.isFinite)) {
    const fallback = makePlane(1, 1)
    return { geometry: { kind: 'plane', ...fallback }, error: 'basePlane requires finite metres' }
  }
  const plane = makePlane(width, height, [origin[0], origin[1], z])
  return { geometry: { kind: 'plane', ...plane } }
}
