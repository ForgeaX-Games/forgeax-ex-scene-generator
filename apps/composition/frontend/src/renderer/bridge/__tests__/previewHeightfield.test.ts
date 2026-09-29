import { describe, expect, it } from 'vitest'
import { meshFromHeightfieldPacket } from '../previewHeightfield'

const packet = {
  type: 'heightfield' as const,
  geometry: {
    kind: 'plane' as const,
    origin: [0, 0, 0] as const,
    xAxis: [1, 0, 0] as const,
    yAxis: [0, 1, 0] as const,
    width: 10,
    height: 10,
  },
  columns: 2,
  rows: 2,
  height: [
    [0, 1],
    [2, 4],
  ],
  mask: [
    [1, 1],
    [1, 1],
  ],
  attributes: {},
}

describe('meshFromHeightfieldPacket', () => {
  it('weaves plane + height into a terrain overlay on the plane extent', () => {
    const mesh = meshFromHeightfieldPacket(packet)
    expect(mesh).not.toBeNull()
    expect(mesh!.role).toBe('terrain')
    expect(mesh!.colors).toBeUndefined()
    expect(mesh!.color).toEqual([0.34, 0.52, 0.28])
    expect(mesh!.indices.length).toBeGreaterThanOrEqual(6)
    const xs = []
    const ys = []
    const zs = []
    for (let i = 0; i < mesh!.positions.length; i += 3) {
      xs.push(mesh!.positions[i]!)
      ys.push(mesh!.positions[i + 1]!)
      zs.push(mesh!.positions[i + 2]!)
    }
    expect(Math.min(...xs)).toBeCloseTo(0, 5)
    expect(Math.max(...xs)).toBeCloseTo(10, 5)
    // Viewport flips authoring +Y once, matching the BasePlane overlay.
    expect(Math.min(...ys)).toBeCloseTo(-10, 5)
    expect(Math.max(...ys)).toBeCloseTo(0, 5)
    expect(Math.max(...zs)).toBeGreaterThan(0)
  })

  it('unwraps a DataTree wire envelope', () => {
    const mesh = meshFromHeightfieldPacket([{ path: [0], items: [packet] }])
    expect(mesh?.indices.length).toBeGreaterThanOrEqual(6)
  })

  it('returns null for a plane or a bare grid', () => {
    expect(meshFromHeightfieldPacket(packet.geometry)).toBeNull()
    expect(meshFromHeightfieldPacket(packet.height)).toBeNull()
  })

  it('paints a red halo when mask is not the default all-1s', () => {
    const mesh = meshFromHeightfieldPacket({
      ...packet,
      mask: [
        [1, 0],
        [0, 0],
      ],
    })
    expect(mesh!.colors).toBeDefined()
    expect(mesh!.colors!.length).toBe(mesh!.positions.length)
    let maxRed = 0
    let minRed = 1
    for (let i = 0; i < mesh!.colors!.length; i += 3) {
      maxRed = Math.max(maxRed, mesh!.colors![i]!)
      minRed = Math.min(minRed, mesh!.colors![i]!)
    }
    expect(maxRed).toBeGreaterThan(0.7)
    expect(minRed).toBeLessThan(0.5)
    expect(mesh!.color).toEqual([0.34, 0.52, 0.28])
  })

  it('weaves from the packet origin, not a guessed live plane', () => {
    const moved = {
      ...packet,
      geometry: { ...packet.geometry, origin: [0, 9, 0] as const },
    }
    const mesh = meshFromHeightfieldPacket(moved)
    const ys = []
    for (let i = 1; i < mesh!.positions.length; i += 3) ys.push(mesh!.positions[i]!)
    expect(Math.max(...ys)).toBeCloseTo(-9, 5)
    expect(Math.min(...ys)).toBeCloseTo(-19, 5)
  })
})
