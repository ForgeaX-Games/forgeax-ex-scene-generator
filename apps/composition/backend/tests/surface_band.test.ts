import { describe, expect, it } from 'vitest'

import { heightfield } from '../../batteries/Modeling/heightfield/heightfield/index.ts'
import { heightfieldMesh } from '../../batteries/Modeling/heightfield/heightfield_mesh/index.ts'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.ts'
import { polyline2d } from '../../batteries/Modeling/geometry2d/polyline2d/index.ts'
import { network2d } from '../../batteries/Modeling/geometry2d/network2d/index.ts'
import { liftToSurface } from '../../batteries/Modeling/surface/lift_to_surface/index.ts'
import { polyline3d } from '../../batteries/Modeling/geometry3d/polyline3d/index.ts'
import { surfaceBand } from '../../batteries/Modeling/surface/surface_band/index.ts'
import { buildSurfaceBand } from '../../vendor/shared/types/scene/surfaceBand.ts'

function gridMesh(width: number, height: number, nx: number, ny: number, z = 0) {
  const positions: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      positions.push((i / nx) * width, (j / ny) * height, z)
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      const b = a + 1
      const c = a + (nx + 1)
      const d = c + 1
      indices.push(a, b, d, a, d, c)
    }
  }
  return { kind: 'mesh' as const, positions, indices }
}

function xyBounds(positions: number[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!)
    maxX = Math.max(maxX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    maxY = Math.max(maxY, positions[i + 1]!)
  }
  return { minX, maxX, minY, maxY }
}

describe('surfaceBand', () => {
  it('builds a planar polyline into one XY corridor (plan metric)', () => {
    const mesh = gridMesh(20, 10, 40, 20)
    const line = polyline3d({ points: [[2, 5, 0], [18, 5, 0]] }).geometry
    const band = surfaceBand({ mesh, geometry: line, width: 2, metric: 'plan' })
    expect(band.error).toBeUndefined()
    expect(band.geometry?.kind).toBe('mesh')
    const positions = band.geometry?.positions as number[]
    const indices = band.geometry?.indices as number[]
    expect(indices.length).toBeGreaterThan(30)
    const box = xyBounds(positions)
    expect(box.minX).toBeGreaterThanOrEqual(0.9)
    expect(box.maxX).toBeLessThan(19.1)
    expect(box.minY).toBeGreaterThan(3.6)
    expect(box.maxY).toBeLessThan(6.4)
    expect(box.maxY - box.minY).toBeGreaterThan(1.5)
    expect(box.maxY - box.minY).toBeLessThan(2.6)
  })

  it('geodesic on a plane matches the plan corridor', () => {
    const mesh = gridMesh(20, 10, 40, 20)
    const line = polyline3d({ points: [[2, 5, 0], [18, 5, 0]] }).geometry
    const plan = surfaceBand({ mesh, geometry: line, width: 2, metric: 'plan' })
    const geo = surfaceBand({ mesh, geometry: line, width: 2, metric: 'geodesic' })
    expect(geo.error).toBeUndefined()
    const a = xyBounds(plan.geometry?.positions as number[])
    const b = xyBounds(geo.geometry?.positions as number[])
    expect(Math.abs((a.maxY - a.minY) - (b.maxY - b.minY))).toBeLessThan(0.6)
  })

  it('keeps a forked network as one mesh', () => {
    const mesh = gridMesh(20, 20, 40, 40)
    const net = {
      kind: 'network3d',
      nodes: [[4, 10, 0], [10, 10, 0], [16, 6, 0], [16, 14, 0]],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 1, to: 3 }],
    }
    const band = surfaceBand({ mesh, geometry: net, width: 2, metric: 'plan' })
    expect(band.error).toBeUndefined()
    expect((band.geometry?.indices as number[]).length).toBeGreaterThan(60)
  })

  it('lifts a Heightfield network and still emits one band', () => {
    const field = heightfield({
      geometry: basePlane({ origin: [0, 0], width: 20, height: 10 }).geometry,
      height: [
        [0, 2, 4, 6],
        [1, 3, 5, 7],
      ],
    }).heightfield
    const mesh = heightfieldMesh({ heightfield: field }).geometry
    const net = network2d({
      nodes: [[4, 5], [10, 5], [16, 5]],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    }).geometry
    const lifted = liftToSurface({ geometry: net, surface: field })
    const band = surfaceBand({
      mesh,
      geometry: lifted.geometry ?? lifted,
      width: 2,
      metric: 'geodesic',
      offset: 0.05,
    })
    expect(band.error).toBeUndefined()
    const z = (band.geometry?.positions as number[]).filter((_, i) => i % 3 === 2)
    expect(Math.min(...z)).toBeGreaterThan(0)
  })

  it('rejects 2D geometry, polygons, and non-positive width', () => {
    const mesh = gridMesh(10, 10, 8, 8)
    const line2d = polyline2d({ points: [[1, 5], [9, 5]] }).geometry
    expect(surfaceBand({ mesh, geometry: line2d, width: 2 }).error).toMatch(/liftToSurface/)
    expect(surfaceBand({ mesh, geometry: { kind: 'polygon3d', points: [[0, 0, 0], [4, 0, 0], [4, 4, 0]] }, width: 2 }).error).toMatch(/polygon/)
    expect(surfaceBand({ mesh, geometry: polyline3d({ points: [[1, 5, 0], [9, 5, 0]] }).geometry, width: 0 }).error).toMatch(/SCENE_GEOMETRY_DEGENERATE/)
  })

  it('offsets plan bands along +Z', () => {
    const mesh = gridMesh(10, 10, 16, 16, 3)
    const line = polyline3d({ points: [[2, 5, 3], [8, 5, 3]] }).geometry
    const band = buildSurfaceBand({ mesh, geometry: line, width: 1.5, metric: 'plan', offset: 0.2 })
    const z = (band.geometry?.positions as number[]).filter((_, i) => i % 3 === 2)
    expect(Math.min(...z)).toBeGreaterThan(3.15)
  })

  it('does not reuse the input mesh triangulation', () => {
    const mesh = gridMesh(20, 10, 2, 1)
    const line = polyline3d({ points: [[2, 5, 0], [18, 5, 0]] }).geometry
    const band = surfaceBand({ mesh, geometry: line, width: 2, metric: 'plan' })
    expect(band.error).toBeUndefined()
    const positions = band.geometry?.positions as number[]
    const ys = positions.filter((_, i) => i % 3 === 1)
    const nearSouth = ys.filter((y) => Math.abs(y - 4) < 0.2)
    const nearNorth = ys.filter((y) => Math.abs(y - 6) < 0.2)
    expect(nearSouth.length).toBeGreaterThan(0)
    expect(nearNorth.length).toBeGreaterThan(0)
    const terrainKeys = new Set<string>()
    for (let i = 0; i < mesh.positions.length; i += 3) {
      terrainKeys.add(`${mesh.positions[i]},${mesh.positions[i + 1]},${mesh.positions[i + 2]}`)
    }
    let novel = 0
    for (let i = 0; i < positions.length; i += 3) {
      if (!terrainKeys.has(`${positions[i]},${positions[i + 1]},${positions[i + 2]}`)) novel += 1
    }
    expect(novel).toBeGreaterThan(positions.length / 6)
  })

  it('fills a network fork with its own junction disk', () => {
    const mesh = gridMesh(20, 20, 4, 4)
    const net = {
      kind: 'network3d',
      nodes: [[4, 10, 0], [10, 10, 0], [16, 6, 0], [16, 14, 0]],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 1, to: 3 }],
    }
    const band = surfaceBand({ mesh, geometry: net, width: 2, metric: 'plan' })
    expect(band.error).toBeUndefined()
    const positions = band.geometry?.positions as number[]
    const indices = band.geometry?.indices as number[]
    let coversFork = false
    for (let t = 0; t < indices.length; t += 3) {
      const ax = positions[indices[t]! * 3]!
      const ay = positions[indices[t]! * 3 + 1]!
      const bx = positions[indices[t + 1]! * 3]!
      const by = positions[indices[t + 1]! * 3 + 1]!
      const cx = positions[indices[t + 2]! * 3]!
      const cy = positions[indices[t + 2]! * 3 + 1]!
      const v0x = bx - ax
      const v0y = by - ay
      const v1x = cx - ax
      const v1y = cy - ay
      const den = v0x * v1y - v1x * v0y
      if (Math.abs(den) < 1e-12) continue
      const v = ((10 - ax) * v1y - v1x * (10 - ay)) / den
      const w = (v0x * (10 - ay) - (10 - ax) * v0y) / den
      const u = 1 - v - w
      if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) {
        coversFork = true
        break
      }
    }
    expect(coversFork).toBe(true)
  })
})
