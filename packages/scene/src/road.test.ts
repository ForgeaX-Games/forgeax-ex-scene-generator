import { describe, expect, it } from 'vitest'

import { diagnoseRoadStructures } from './road.js'

function strip(name: string, x0: number, x1: number, y: number, z0: number, z1: number, extra?: {
  structure?: string
  part?: string
  role?: string
  file?: string
  line?: number
}) {
  const positions: number[] = []
  const indices: number[] = []
  const steps = 8
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const x = x0 + (x1 - x0) * t
    const z = z0 + (z1 - z0) * t
    positions.push(x, y - 2, z, x, y + 2, z)
    if (k > 0) {
      const i = (k - 1) * 2
      indices.push(i, i + 1, i + 3, i, i + 3, i + 2)
    }
  }
  return {
    id: name,
    name,
    positions,
    indices,
    box: {
      minX: Math.min(x0, x1),
      maxX: Math.max(x0, x1),
      minY: y - 2,
      maxY: y + 2,
      minZ: Math.min(z0, z1),
      maxZ: Math.max(z0, z1),
    },
    role: extra?.role,
    structure: extra?.structure,
    part: extra?.part,
    source: extra?.file ? { file: extra.file, line: extra.line ?? 1 } : undefined,
  }
}

function quad(
  x: number,
  y: number,
  z: number,
  w = 4,
  d = 4,
): { positions: number[]; indices: number[] } {
  return {
    positions: [
      x, y, z,
      x + w, y, z,
      x, y + d, z,
      x + w, y + d, z,
    ],
    indices: [0, 1, 2, 1, 3, 2],
  }
}

function joinIslands(...patches: Array<{ positions: number[]; indices: number[] }>) {
  const positions: number[] = []
  const indices: number[] = []
  for (const patch of patches) {
    const base = positions.length / 3
    positions.push(...patch.positions)
    for (const i of patch.indices) indices.push(base + i)
  }
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!)
    maxX = Math.max(maxX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    maxY = Math.max(maxY, positions[i + 1]!)
    minZ = Math.min(minZ, positions[i + 2]!)
    maxZ = Math.max(maxZ, positions[i + 2]!)
  }
  return { positions, indices, box: { minX, maxX, minY, maxY, minZ, maxZ } }
}

describe('diagnoseRoadStructures', () => {
  it('stays quiet for one marked pavement with a gentle grade', () => {
    const found = diagnoseRoadStructures([
      strip('deck', 0, 40, 0, 10, 12, { structure: 'road', part: 'pavement', role: 'road', file: 'viaduct.scene.ts', line: 12 }),
    ])
    expect(found.map((item) => item.code)).toEqual([])
  })

  it('asks for structure annotation when only mesh.role marks the road', () => {
    const found = diagnoseRoadStructures([
      strip('lanes', 0, 40, 0, 4, 4, { role: 'road', file: 'roads.scene.ts', line: 8 }),
    ])
    const unmarked = found.find((item) => item.code === 'SCENE_ROAD_UNMARKED')
    expect(unmarked?.message).toContain('"lanes" (roads.scene.ts:8)')
    expect(unmarked?.howToFix?.[0]).toMatch(/structure: 'road'/)
  })

  it('fails spliced pavement pieces that share a junction', () => {
    const found = diagnoseRoadStructures([
      strip('west', 0, 30, 0, 8, 8, { structure: 'road', part: 'pavement', file: 'viaduct.scene.ts', line: 20 }),
      strip('east', 28, 60, 0, 8, 8, { structure: 'road', part: 'pavement', file: 'viaduct.scene.ts', line: 21 }),
      strip('south', 28, 32, 6, 8, 8, { structure: 'road', part: 'pavement', file: 'viaduct.scene.ts', line: 22 }),
    ])
    const split = found.find((item) => item.code === 'SCENE_ROAD_PAVEMENT_SPLIT')
    expect(split?.severity).toBe('error')
    expect(split?.message).toContain('"west" (viaduct.scene.ts:20)')
    expect(split?.message).toContain('"east"')
  })

  it('fails one hung mesh whose triangles do not share edges, even when XY occupancy would merge them', () => {
    const joined = joinIslands(quad(0, 0, 8, 10, 4), quad(12, 0, 8, 10, 4))
    const found = diagnoseRoadStructures([
      {
        id: 'deck',
        name: 'viaduct-deck',
        ...joined,
        structure: 'road',
        part: 'pavement',
        role: 'road',
        source: { file: 'viaduct.scene.ts', line: 40 },
      },
    ])
    const split = found.find((item) => item.code === 'SCENE_ROAD_PAVEMENT_SPLIT')
    expect(split?.severity).toBe('error')
    expect(split?.message).toMatch(/2 triangle-connected pavement island/)
    expect(split?.message).toContain('"viaduct-deck" (viaduct.scene.ts:40)')
    expect(split?.howToFix?.[0]).toMatch(/share edges/)
  })

  it('does not treat a stacked shoulder as a second pavement', () => {
    const found = diagnoseRoadStructures([
      strip('carriage', 0, 40, 0, 5, 5, { structure: 'road', part: 'pavement' }),
      strip('shoulder', 0, 40, 0, 4.7, 4.7, { structure: 'road', part: 'shoulder' }),
    ])
    expect(found.map((item) => item.code)).not.toContain('SCENE_ROAD_PAVEMENT_SPLIT')
  })

  it('warns a 20% chord and locates it', () => {
    const found = diagnoseRoadStructures([
      strip('deck', 0, 48, 0, 10, 19.6, { structure: 'road', part: 'pavement', file: 'viaduct.scene.ts', line: 40 }),
    ])
    const grade = found.find((item) => item.code === 'SCENE_ROAD_GRADE')
    expect(grade?.severity).toBe('warning')
    expect(grade?.message).toMatch(/22\.|21\.|20\.|19\./)
    expect(grade?.actual).toEqual(expect.objectContaining({
      locations: expect.arrayContaining([
        expect.objectContaining({
          name: 'deck',
          file: 'viaduct.scene.ts',
          line: 40,
          x: expect.any(Number),
          y: expect.any(Number),
          percent: expect.any(Number),
        }),
      ]),
    }))
    expect(found.map((item) => item.code)).not.toContain('SCENE_ROAD_GRADE_FAULT')
  })

  it('errors a cliff-like pavement grade and keeps the world metre point', () => {
    const found = diagnoseRoadStructures([
      strip('deck', 0, 48, 0, 10, 34, { structure: 'road', part: 'pavement', file: 'viaduct.scene.ts', line: 55 }),
    ])
    const fault = found.find((item) => item.code === 'SCENE_ROAD_GRADE_FAULT')
    expect(fault?.severity).toBe('error')
    expect(fault?.message).toMatch(/% at \(/)
    expect(fault?.actual).toEqual(expect.objectContaining({
      locations: expect.arrayContaining([
        expect.objectContaining({
          name: 'deck',
          slope: expect.any(Number),
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      ]),
    }))
  })
})
