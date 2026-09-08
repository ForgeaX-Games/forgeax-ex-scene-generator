/**
 * terrace_walls: Stone retaining walls on agricultural terrace risers only.
 * Contours are clipped away from plaza, roads, river, landmarks and house plots
 * so the walls cannot run through the settlement.
 */

import { buildRetainingWallsMesh, unwrapHeightGrid, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface TerraceWallsResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

function parsePoints(raw: unknown): Array<[number, number]> {
  if (!raw) return []
  let cur: unknown = raw
  if (cur && typeof cur === 'object' && 'items' in cur) cur = (cur as { items: unknown }).items
  if (cur && typeof cur === 'object' && !Array.isArray(cur) && 'x' in cur && 'y' in cur) {
    return [[Number((cur as { x: number }).x), Number((cur as { y: number }).y)]]
  }
  if (!Array.isArray(cur)) return []
  if (cur.length >= 2 && typeof cur[0] === 'number') return [[Number(cur[0]), Number(cur[1])]]
  const out: Array<[number, number]> = []
  for (const p of cur) {
    if (Array.isArray(p) && p.length >= 2) out.push([Number(p[0]), Number(p[1])])
    else if (p && typeof p === 'object' && 'x' in p && 'y' in p) {
      out.push([Number((p as { x: number }).x), Number((p as { y: number }).y)])
    }
  }
  return out
}

function distToPoly(px: number, py: number, pts: ReadonlyArray<readonly [number, number]>): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(px - pts[0]![0], py - pts[0]![1])
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i]![0], ay = pts[i]![1]
    const bx = pts[i + 1]![0], by = pts[i + 1]![1]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 < 1e-8 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (d < min) min = d
  }
  return min
}

function flushRun(run: Array<[number, number]>, curves: Array<Array<[number, number]>>): void {
  if (run.length < 3) {
    run.length = 0
    return
  }
  let len = 0
  for (let i = 1; i < run.length; i++) {
    len += Math.hypot(run[i]![0] - run[i - 1]![0], run[i]![1] - run[i - 1]![1])
  }
  if (len >= 4) curves.push(run.slice())
  run.length = 0
}

export function terraceWalls(input: Record<string, unknown>): TerraceWallsResult {
  const grid = unwrapHeightGrid(input.heightGrid)
  if (!grid || grid.length === 0) {
    return { triangleCount: 0, error: 'heightGrid is required' }
  }

  const H = grid.length
  const W = grid[0]!.length
  const mask = unwrapHeightGrid(input.terraceMask)

  const plaza = parsePoints(input.plazaCenter)[0] ?? null
  const plazaR = typeof input.plazaRadius === 'number' ? input.plazaRadius : 7.4
  const tower = parsePoints(input.towerPosition)[0] ?? null
  const mill = parsePoints(input.millPosition)[0] ?? null
  const avoid = parsePoints(input.avoidPoints)
  const riverPts = parsePoints(input.riverPoints)
  const riverW = typeof input.riverWidth === 'number' ? input.riverWidth : 8

  const corridors: Array<{ pts: Array<[number, number]>; half: number }> = [
    { pts: parsePoints(input.roadPoints), half: 2.0 },
    { pts: parsePoints(input.ringPoints), half: 1.8 },
    { pts: parsePoints(input.trailPoints), half: 1.2 },
    { pts: parsePoints(input.feederPoints), half: 1.4 },
    { pts: parsePoints(input.millAccessPoints), half: 1.4 },
  ].filter((c) => c.pts.length >= 2)

  const clearance = typeof input.clearance === 'number' ? input.clearance : 3.4

  function isClear(x: number, y: number): boolean {
    if (plaza && Math.hypot(x - plaza[0], y - plaza[1]) < plazaR + clearance + 1.2) return false
    if (tower && Math.hypot(x - tower[0], y - tower[1]) < 4.8) return false
    if (mill && Math.hypot(x - mill[0], y - mill[1]) < 5.2) return false
    for (const [ax, ay] of avoid) {
      if (Math.hypot(x - ax, y - ay) < clearance) return false
    }
    for (const c of corridors) {
      if (distToPoly(x, y, c.pts) < c.half + 2.0) return false
    }
    if (riverPts.length > 0 && distToPoly(x, y, riverPts) < riverW * 0.5 + 2.4) return false
    return true
  }

  const riser: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false))
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      if (mask && mask[y]?.[x] === 0) continue
      const z = grid[y]![x] ?? 0
      const zS = grid[y + 1]![x] ?? z
      const zE = grid[y]![x + 1] ?? z
      if (z - zS >= 0.55 || Math.abs(z - zE) >= 0.75) riser[y]![x] = true
    }
  }

  const curves: Array<Array<[number, number]>> = []

  for (let y = 2; y < H - 2; y++) {
    const run: Array<[number, number]> = []
    for (let x = 2; x < W - 2; x++) {
      if (riser[y]![x] && isClear(x + 0.5, y + 0.5)) {
        if (run.length > 0 && x + 0.5 - run[run.length - 1]![0] > 2.6) flushRun(run, curves)
        run.push([x + 0.5, y + 0.5])
      } else {
        flushRun(run, curves)
      }
    }
    flushRun(run, curves)
  }

  if (curves.length === 0) {
    const levels: number[] = []
    if (mask) {
      const seen = new Set<number>()
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (mask[y]?.[x] === 0) continue
          const step = Math.round((grid[y]![x] ?? 0) * 2) / 2
          if (!seen.has(step)) {
            seen.add(step)
            levels.push(step)
          }
        }
      }
      levels.sort((a, b) => a - b)
    }
    for (const lvl of levels.slice(0, 8)) {
      const run: Array<[number, number]> = []
      for (let x = 3; x < W - 3; x++) {
        let hit: [number, number] | null = null
        for (let y = 3; y < H - 3; y++) {
          if (mask && mask[y]?.[x] === 0) continue
          const z0 = grid[y]![x] ?? 0
          const z1 = grid[y + 1]![x] ?? 0
          if ((z0 - lvl) * (z1 - lvl) <= 0 && Math.abs(z0 - z1) > 0.25) {
            hit = [x + 0.5, y + 0.5]
            break
          }
        }
        if (hit && isClear(hit[0], hit[1])) {
          if (run.length > 0 && hit[0] - run[run.length - 1]![0] > 2.6) flushRun(run, curves)
          run.push(hit)
        } else {
          flushRun(run, curves)
        }
      }
      flushRun(run, curves)
    }
  }

  const mesh = buildRetainingWallsMesh({
    curves,
    heightGrid: grid,
    wallThickness: typeof input.wallThickness === 'number' ? input.wallThickness : undefined,
    wallHeight: typeof input.wallHeight === 'number' ? input.wallHeight : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) {
    // Empty clip is a valid agricultural layout (village ate every riser).
    // Returning `error` aborts the whole graph execute and hides Control handles.
    return { mesh: { positions: [], indices: [] }, triangleCount: 0 }
  }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
