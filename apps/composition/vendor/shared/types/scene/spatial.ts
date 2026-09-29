/**
 * Geometry plane frame for first-batch Scene Script.
 * Coordinates are metres. This is not a leftover city catalog.
 */

export interface Plane {
  origin: readonly [number, number, number]
  xAxis: readonly [number, number, number]
  yAxis: readonly [number, number, number]
  width: number
  height: number
  rotationDeg?: number
}

export function makePlane(width: number, height: number, origin: readonly [number, number, number] = [0, 0, 0]): Plane {
  return {
    origin,
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    width,
    height,
  }
}

export function planePointToWorld(plane: Plane, x: number, y: number): readonly [number, number, number] {
  return [
    plane.origin[0] + plane.xAxis[0] * x + plane.yAxis[0] * y,
    plane.origin[1] + plane.xAxis[1] * x + plane.yAxis[1] * y,
    plane.origin[2] + plane.xAxis[2] * x + plane.yAxis[2] * y,
  ]
}

/**
 * Unwrap DataTree wire envelopes so Geometry plane payloads can be read.
 */
export function unwrapSpatialWireValue(val: unknown, depth: number = 0): unknown {
  if (val === null || val === undefined || depth > 8) return val
  if (isPlane(val)) return val
  if (Array.isArray(val)) {
    if (val.length === 0) return val
    if (typeof val[0] === 'object' && val[0] !== null && 'items' in val[0]) {
      const items = val.flatMap((entry) => (entry && Array.isArray((entry as { items: unknown[] }).items) ? (entry as { items: unknown[] }).items : [(entry as { items: unknown }).items]))
      if (items.length === 1) return unwrapSpatialWireValue(items[0], depth + 1)
      return items.map((it) => unwrapSpatialWireValue(it, depth + 1))
    }
    if (val.length === 1) {
      const unwrapped = unwrapSpatialWireValue(val[0], depth + 1)
      if (isPlane(unwrapped)) return unwrapped
    }
    return val.map((it) => unwrapSpatialWireValue(it, depth + 1))
  }
  if (typeof val === 'object') {
    const rec = val as Record<string, unknown>
    if ('items' in rec && Array.isArray(rec.items)) {
      if (rec.items.length === 1) return unwrapSpatialWireValue(rec.items[0], depth + 1)
      return rec.items.map((it) => unwrapSpatialWireValue(it, depth + 1))
    }
    if (rec.geometry && typeof rec.geometry === 'object') return unwrapSpatialWireValue(rec.geometry, depth + 1)
    if (rec.kind === 'plane' && isPlane(rec)) return rec
  }
  return val
}

export function parseSpatialVector2(
  val: unknown,
  fallback: readonly [number, number] = [0, 0],
): readonly [number, number] {
  const unwrapped = unwrapSpatialWireValue(val)
  if (unwrapped === null || unwrapped === undefined) return fallback
  if (Array.isArray(unwrapped)) {
    if (unwrapped.length >= 2 && Number.isFinite(Number(unwrapped[0])) && Number.isFinite(Number(unwrapped[1]))) {
      return [Number(unwrapped[0]), Number(unwrapped[1])]
    }
    if (unwrapped.length === 1 && Array.isArray(unwrapped[0])) {
      return parseSpatialVector2(unwrapped[0], fallback)
    }
  }
  if (typeof unwrapped === 'object') {
    const rec = unwrapped as Record<string, unknown>
    const x = Number(rec.x ?? rec.width ?? (Array.isArray(rec) ? rec[0] : undefined))
    const y = Number(rec.y ?? rec.height ?? rec.depth ?? (Array.isArray(rec) ? rec[1] : undefined))
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  }
  return fallback
}

export function isPlane(value: unknown): value is Plane {
  if (!value || typeof value !== 'object') return false
  if ((value as { kind?: unknown }).kind === 'mesh') return false
  const plane = value as Plane
  const hasExtent = Number.isFinite(plane.width) && Number.isFinite(plane.height) && Array.isArray(plane.origin)
  if ((value as { kind?: unknown }).kind === 'plane') return hasExtent
  return hasExtent && Array.isArray(plane.xAxis) && Array.isArray(plane.yAxis)
}

export function asPlane(value: unknown): Plane | null {
  if (!value) return null
  const unwrapped = unwrapSpatialWireValue(value)
  if (!unwrapped || typeof unwrapped !== 'object') return null
  if (isPlane(unwrapped)) return unwrapped
  const rec = unwrapped as Record<string, unknown>
  if (rec.kind === 'plane' && isPlane(rec)) return rec
  if (isPlane(rec.geometry)) return rec.geometry
  if ('geometry' in rec) {
    const unwrappedGeometry = unwrapSpatialWireValue(rec.geometry)
    if (isPlane(unwrappedGeometry)) return unwrappedGeometry
  }
  return null
}
