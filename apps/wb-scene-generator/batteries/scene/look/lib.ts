export type PreviewSurface = {
  baseColor: readonly [number, number, number]
  roughness: number
  metallic: number
}

export type MaterialLook = {
  id: string
  surface: PreviewSurface
}

function asColor(value: unknown, fallback: readonly [number, number, number]): readonly [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    const r = Number(value[0])
    const g = Number(value[1])
    const b = Number(value[2])
    if ([r, g, b].every(Number.isFinite)) return [r, g, b]
  }
  if (value && typeof value === 'object') {
    const rec = value as { r?: unknown; g?: unknown; b?: unknown; baseColor?: unknown }
    if (rec.baseColor) return asColor(rec.baseColor, fallback)
    const r = Number(rec.r)
    const g = Number(rec.g)
    const b = Number(rec.b)
    if ([r, g, b].every(Number.isFinite)) return [r, g, b]
  }
  return fallback
}

function asSurface(value: unknown): PreviewSurface {
  const rec = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    baseColor: asColor(rec.baseColor ?? value, [0.72, 0.72, 0.70]),
    roughness: Number.isFinite(Number(rec.roughness)) ? Number(rec.roughness) : 0.7,
    metallic: Number.isFinite(Number(rec.metallic)) ? Number(rec.metallic) : 0.02,
  }
}

function asMaterial(value: unknown): MaterialLook {
  const rec = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const nested = rec.material && typeof rec.material === 'object' ? rec.material as Record<string, unknown> : rec
  return {
    id: typeof nested.id === 'string' && nested.id ? nested.id : 'look',
    surface: asSurface(nested.surface ?? nested),
  }
}

function isMesh(value: unknown): value is { positions: number[]; indices: number[]; [key: string]: unknown } {
  if (!value || typeof value !== 'object') return false
  const rec = value as { positions?: unknown; indices?: unknown }
  return Array.isArray(rec.positions) && Array.isArray(rec.indices)
}

export function previewSurfaceOp(input: Record<string, unknown>): { surface: PreviewSurface } {
  return {
    surface: {
      baseColor: asColor(input.baseColor, [Number(input.r) || 0.72, Number(input.g) || 0.72, Number(input.b) || 0.70]),
      roughness: Number.isFinite(Number(input.roughness)) ? Number(input.roughness) : 0.7,
      metallic: Number.isFinite(Number(input.metallic)) ? Number(input.metallic) : 0.02,
    },
  }
}

export function materialLookOp(input: Record<string, unknown>): { material: MaterialLook } {
  const surface = asSurface(input.surface)
  const id = typeof input.id === 'string' && input.id ? input.id : 'look'
  return { material: { id, surface } }
}

export function bindMaterialOp(input: Record<string, unknown>): { mesh?: Record<string, unknown>; material?: MaterialLook; error?: string } {
  if (!isMesh(input.mesh)) return { error: 'bindMaterial requires a mesh' }
  const material = asMaterial(input.material)
  const color = material.surface.baseColor
  const verts = Math.floor(input.mesh.positions.length / 3)
  const existing = Array.isArray(input.mesh.colors) ? input.mesh.colors as number[] : []
  const colors = Array.from({ length: verts * 3 }, (_, i) => {
    const channel = color[i % 3]!
    const prior = existing[i]
    if (typeof prior === 'number' && Number.isFinite(prior)) return prior * 0.28 + channel * 0.72
    return channel
  })
  return {
    mesh: {
      ...input.mesh,
      color,
      colors,
      material,
    },
    material,
  }
}
