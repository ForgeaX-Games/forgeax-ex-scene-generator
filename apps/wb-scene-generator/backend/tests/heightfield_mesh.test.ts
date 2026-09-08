import { describe, expect, it } from 'vitest'
import { hillContourGenerate } from '../../batteries/components/elements/hill_contour_generate/index.ts'
import { heightfieldMesh } from '../../batteries/scene/bridge/heightfield_mesh/index.ts'
import { meshToNode } from '../../batteries/scene/bridge/mesh_to_node/index.ts'
import { contentSchema } from '../../vendor/shared/types/scene/content.ts'
import { getNode } from '../../vendor/shared/types/scene/graph.ts'
import { buildHeightfieldMesh, sampleHeightfieldSurface } from '../../vendor/shared/types/scene/heightfield.ts'

function rampGrid(): number[][] {
  return [
    [1, 1, 0],
    [2, 2, 0],
    [3, 3, 0],
  ]
}

describe('heightfield_mesh + mesh_to_node', () => {
  it('builds a continuous hillside (not a per-cell voxel column)', () => {
    const mesh = buildHeightfieldMesh(rampGrid())
    expect(mesh).not.toBeNull()
    expect(mesh!.indices.length).toBeGreaterThanOrEqual(6)
    expect(mesh!.positions.length).toBeGreaterThanOrEqual(9)
    const zs = []
    for (let i = 2; i < mesh!.positions.length; i += 3) zs.push(mesh!.positions[i]!)
    expect(Math.max(...zs)).toBeGreaterThan(Math.min(...zs))
    expect(mesh!.color).toEqual([0.82, 0.82, 0.8])
    expect(mesh!.role).toBe('terrain')
  })

  it('samples the same Z the terrain mesh uses at integer corners and fractional XY', () => {
    const grid = [
      [1, 3, 5],
      [2, 4, 6],
      [3, 5, 7],
    ]
    const cellSize = 2
    const mesh = buildHeightfieldMesh(grid, { cellSize })!
    for (let j = 0; j <= 3; j++) {
      for (let i = 0; i <= 3; i++) {
        const x = i * cellSize
        const y = -j * cellSize
        let meshZ: number | undefined
        for (let v = 0; v < mesh.positions.length; v += 3) {
          if (Math.abs(mesh.positions[v]! - x) < 1e-9 && Math.abs(mesh.positions[v + 1]! - y) < 1e-9) {
            meshZ = mesh.positions[v + 2]
            break
          }
        }
        if (meshZ === undefined) continue
        expect(sampleHeightfieldSurface(grid, i, j) * cellSize).toBeCloseTo(meshZ, 8)
      }
    }
    const mid = sampleHeightfieldSurface(grid, 1.5, 1.5)
    expect(mid).toBeGreaterThan(sampleHeightfieldSurface(grid, 1, 1))
    expect(mid).toBeLessThan(sampleHeightfieldSurface(grid, 2, 2))
  })

  it('matches the terrain mesh triangle, not a bilinear quad, at fractional XY', () => {
    const grid = [
      [1, 8, 2],
      [3, 1, 9],
      [7, 4, 2],
    ]
    const cellSize = 1
    const mesh = buildHeightfieldMesh(grid, { cellSize })!
    const meshZAt = (wx: number, wy: number): number | null => {
      const idx = mesh.indices
      const p = mesh.positions
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!
        const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!
        const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!
        const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!
        const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if (Math.abs(det) < 1e-12) continue
        const wB = ((wx - ax) * (cy - ay) - (cx - ax) * (wy - ay)) / det
        const wC = ((bx - ax) * (wy - ay) - (wx - ax) * (by - ay)) / det
        const wA = 1 - wB - wC
        if (wA >= -1e-5 && wB >= -1e-5 && wC >= -1e-5) return wA * az + wB * bz + wC * cz
      }
      return null
    }
    for (const [x, y] of [[0.25, 0.2], [0.8, 0.3], [1.2, 1.7], [2.1, 0.9], [1.55, 1.55]] as const) {
      const got = meshZAt(x * cellSize, -y * cellSize)
      expect(got).not.toBeNull()
      expect(sampleHeightfieldSurface(grid, x, y) * cellSize).toBeCloseTo(got!, 5)
    }
  })

  it('unwraps a DataTree-shaped height grid before sampling', () => {
    const raw = [[4, 5], [6, 7]]
    expect(sampleHeightfieldSurface({ items: [raw] }, 0, 0)).toBe(sampleHeightfieldSurface(raw, 0, 0))
    expect(sampleHeightfieldSurface([{ path: [0], items: [raw] }], 1, 1)).toBe(sampleHeightfieldSurface(raw, 1, 1))
  })

  it('battery emits mesh; mesh_to_node hangs schema=mesh on the scene tree', () => {
    const result = heightfieldMesh({ grid: rampGrid() })
    expect(result.error).toBeUndefined()
    expect(result.mesh).toBeDefined()
    expect(result.triangleCount).toBeGreaterThan(0)

    const node = meshToNode({ name: 'Terrain', mesh: result.mesh })
    expect(node.error).toBeUndefined()
    const hung = getNode(node.scene!.graph, node.scene!.focus)
    expect(contentSchema(hung?.content)).toBe('mesh')
    expect(hung?.schema).toBe('mesh')
  })

  it('hill_contour_generate → heightfield_mesh → mesh_to_node is a white-model mountain', () => {
    const mask = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1))
    const hill = hillContourGenerate({ inputGrid: mask, contourLevels: 4, seed: 1, hillCount: 1 })
    expect(hill.error).toBeUndefined()
    const hf = heightfieldMesh({ grid: hill.outputGrid })
    expect(hf.error).toBeUndefined()
    expect(hf.triangleCount).toBeGreaterThan(0)
    const hung = meshToNode({ name: 'Terrain', mesh: hf.mesh })
    expect(contentSchema(getNode(hung.scene!.graph, hung.scene!.focus)?.content)).toBe('mesh')
  })
})
