import { buildBoxesMesh } from '../../../../vendor/dist/shared/types/index.js'

function flattenNumbers(raw: unknown): number[] {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw]
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const item of raw) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item)
    else if (item && typeof item === 'object' && Array.isArray((item as { items?: unknown }).items)) {
      out.push(...flattenNumbers((item as { items: unknown }).items))
    }
  }
  return out
}

export function gridToBoxes(input: Record<string, unknown>): {
  mesh?: ReturnType<typeof buildBoxesMesh>
  boxCount: number
  error?: string
} {
  const buildingHeight = Number(input.buildingHeight ?? input.height ?? 3)
  const footprint = Number(input.footprint ?? 2)
  const cellSize = Number(input.cellSize ?? 1)
  const heights = flattenNumbers(input.z ?? input.heights)
  const mesh = buildBoxesMesh(input.points, {
    heightGrid: input.heightGrid ?? input.grid,
    ...(heights.length ? { heights } : {}),
    buildingHeight: Number.isFinite(buildingHeight) && buildingHeight > 0 ? buildingHeight : 3,
    footprint: Number.isFinite(footprint) && footprint > 0 ? footprint : 2,
    cellSize: Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1,
  })
  if (!mesh) return { boxCount: 0, error: 'points are required' }
  return { mesh, boxCount: mesh.indices.length / 36 }
}
