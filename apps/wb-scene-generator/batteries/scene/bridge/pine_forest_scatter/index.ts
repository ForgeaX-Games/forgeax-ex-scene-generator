/**
 * pine_forest_scatter: Scatter white-box pine trees across forest zones.
 */

import { buildPineTreesMesh, unwrapHeightGrid, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface PineForestScatterResult {
  mesh?: SceneMesh
  points: Array<[number, number]>
  triangleCount: number
  error?: string
}

export function pineForestScatter(input: Record<string, unknown>): PineForestScatterResult {
  const grid = unwrapHeightGrid(input.heightGrid)
  if (!grid || grid.length === 0) {
    return { points: [], triangleCount: 0, error: 'heightGrid is required' }
  }

  const H = grid.length
  const W = grid[0]!.length
  const mask = unwrapHeightGrid(input.forestMask)
  const count = typeof input.count === 'number' ? Math.max(1, Math.min(400, input.count)) : 24
  const seed = typeof input.seed === 'number' ? input.seed : 42

  let s = (Math.abs(Math.floor(seed)) * 16807 + 1) % 2147483647
  function rand(): number {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }

  // Find candidate cells where mask > 0 or slope is suitable
  const candidates: Array<[number, number]> = []
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (mask && mask[y]?.[x] === 0) continue
      candidates.push([x, y])
    }
  }

  // If no mask cells, fallback to general hillside
  if (candidates.length === 0) {
    for (let y = 3; y < H - 3; y++) {
      for (let x = 3; x < W - 3; x++) {
        const z = grid[y]?.[x] ?? 0
        if (z >= 4.0 && z <= 48.0) {
          candidates.push([x, y])
        }
      }
    }
  }

  const avoid: Array<[number, number]> = []
  let avoidRaw: unknown = input.avoidPoints ?? input.points
  if (avoidRaw && typeof avoidRaw === 'object' && 'items' in avoidRaw) {
    avoidRaw = (avoidRaw as { items: unknown }).items
  }
  if (Array.isArray(avoidRaw)) {
    for (const p of avoidRaw) {
      if (Array.isArray(p) && p.length >= 2) avoid.push([Number(p[0]), Number(p[1])])
      else if (p && typeof p === 'object' && 'x' in p && 'y' in p) {
        avoid.push([Number((p as { x: number }).x), Number((p as { y: number }).y)])
      }
    }
  }
  const avoidRadius = typeof input.avoidRadius === 'number' ? input.avoidRadius : 3.6
  const plazaR = typeof input.plazaRadius === 'number' ? input.plazaRadius : 0
  let plaza: [number, number] | null = null
  const plazaRaw = input.plazaCenter
  if (Array.isArray(plazaRaw) && plazaRaw.length >= 2) plaza = [Number(plazaRaw[0]), Number(plazaRaw[1])]
  else if (plazaRaw && typeof plazaRaw === 'object' && 'x' in plazaRaw && 'y' in plazaRaw) {
    plaza = [Number((plazaRaw as { x: number }).x), Number((plazaRaw as { y: number }).y)]
  }

  const points: Array<[number, number]> = []
  const minDist = 2.4

  for (let attempt = 0; attempt < count * 8 && points.length < count; attempt++) {
    if (candidates.length === 0) break
    const cIdx = Math.floor(rand() * candidates.length)
    const [cx, cy] = candidates[cIdx]!
    const jx = cx + (rand() - 0.5) * 1.6
    const jy = cy + (rand() - 0.5) * 1.6

    let tooClose = false
    if (plaza && Math.hypot(jx - plaza[0], jy - plaza[1]) < plazaR + 3.2) tooClose = true
    if (!tooClose) {
      for (const [px, py] of avoid) {
        if (Math.hypot(px - jx, py - jy) < avoidRadius) {
          tooClose = true
          break
        }
      }
    }
    if (!tooClose) {
      for (const [px, py] of points) {
        if (Math.hypot(px - jx, py - jy) < minDist) {
          tooClose = true
          break
        }
      }
    }
    if (!tooClose) {
      points.push([Math.round(jx * 10) / 10, Math.round(jy * 10) / 10])
    }
  }

  const mesh = buildPineTreesMesh({
    points,
    heightGrid: grid,
    minHeight: typeof input.minHeight === 'number' ? input.minHeight : undefined,
    maxHeight: typeof input.maxHeight === 'number' ? input.maxHeight : undefined,
    seed,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) return { points, triangleCount: 0, error: 'failed to generate pine trees mesh' }
  return { mesh, points, triangleCount: mesh.indices.length / 3 }
}
