import { describe, expect, it } from 'vitest'
import {
  buildObjectInstanceCells,
  computeCollisionFootprint,
  computeColumnHeight,
  OBJECT_FOOTPRINT_CELL_COVERAGE_THRESHOLD,
  resolveObjectPlacement,
  snapFootprintToBottomCenter,
} from '../objectPlacement'

describe('object placement geometry', () => {
  it('centers a rectangle footprint instead of expanding for a tiny boundary sliver', () => {
    expect(computeCollisionFootprint({
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 32.2,
      height: 16.1,
    }, 16)).toEqual({ width: 2, height: 1 })
  })

  it('computes a centered grid footprint for a rectangle collision mask', () => {
    expect(computeCollisionFootprint({
      kind: 'rectangle',
      x: 4,
      y: 16,
      width: 32,
      height: 30,
    }, 16)).toEqual({ width: 2, height: 2 })
  })

  it('computes a meaningful-coverage footprint for a polygon collision mask', () => {
    expect(computeCollisionFootprint({
      kind: 'polygon',
      points: [{ x: 1, y: 1 }, { x: 31, y: 2 }, { x: 20, y: 33 }],
    }, 16)).toEqual({ width: 1, height: 2 })
  })

  it('keeps tiny collision masks occupying at least one centered cell', () => {
    expect(computeCollisionFootprint({
      kind: 'rectangle',
      x: 18,
      y: 17,
      width: 1,
      height: 1,
    }, 16)).toEqual({ width: 1, height: 1 })
  })

  it('documents the default sliver threshold for polygon footprint coverage', () => {
    expect(OBJECT_FOOTPRINT_CELL_COVERAGE_THRESHOLD).toBeGreaterThanOrEqual(0.2)
    expect(OBJECT_FOOTPRINT_CELL_COVERAGE_THRESHOLD).toBeLessThanOrEqual(0.25)
  })

  it('drops humanoid-like top and bottom sliver rows while preserving the anchor-relative center', () => {
    const footprint = computeCollisionFootprint({
      kind: 'rectangle',
      x: 15.9,
      y: 15.2,
      width: 32.2,
      height: 32.6,
    }, 16, {
      widthPx: 64,
      heightPx: 64,
      anchorX: 0.5,
      anchorY: 0.5,
    })

    expect(footprint).toEqual({ width: 2, height: 2, offsetX: -1, offsetY: -1 })
    expect(snapFootprintToBottomCenter({ x: 10, y: 20, z: 0 }, footprint)).toEqual({
      x: 9,
      y: 19,
      z: 0,
    })
  })

  it('keeps an asymmetric rectangle centered on its collision area instead of shifting right visually', () => {
    const footprint = computeCollisionFootprint({
      kind: 'rectangle',
      x: 6.4,
      y: 16,
      width: 32,
      height: 16,
    }, 16, {
      widthPx: 64,
      heightPx: 64,
      anchorX: 0.75,
      anchorY: 0.5,
    })

    expect(footprint).toEqual({ width: 2, height: 1, offsetX: -2, offsetY: -1 })
    expect(snapFootprintToBottomCenter({ x: 10, y: 20, z: 0 }, footprint)).toEqual({
      x: 8,
      y: 19,
      z: 0,
    })
  })

  it('preserves a rectangle collision mask offset relative to the bottom-origin anchor', () => {
    const footprint = computeCollisionFootprint({
      kind: 'rectangle',
      x: 3.54,
      y: 1.52,
      width: 436.24,
      height: 221.65,
    }, 16, {
      widthPx: 455,
      heightPx: 453,
      anchorX: 0.4871605103,
      anchorY: 0.2480118615,
    })

    expect(footprint).toEqual({ width: 27, height: 14, offsetX: -13, offsetY: -7 })
    expect(snapFootprintToBottomCenter({ x: 100, y: 200, z: 0 }, footprint)).toEqual({
      x: 87,
      y: 193,
      z: 0,
    })
  })

  it('preserves a polygon collision mask offset relative to the bottom-origin anchor', () => {
    const footprint = computeCollisionFootprint({
      kind: 'polygon',
      points: [
        { x: 3.54, y: 1.52 },
        { x: 439.78, y: 1.52 },
        { x: 439.78, y: 223.17 },
        { x: 3.54, y: 223.17 },
      ],
    }, 16, {
      widthPx: 455,
      heightPx: 453,
      anchorX: 0.4871605103,
      anchorY: 0.2480118615,
    })

    expect(footprint).toEqual({ width: 27, height: 14, offsetX: -13, offsetY: -7 })
  })

  it('keeps hospital-like rectangle geometry broad without extra sliver columns', () => {
    expect(computeCollisionFootprint({
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 432.8,
      height: 224.4,
    }, 16, {
      widthPx: 432.8,
      heightPx: 224.4,
      anchorX: 0.5,
      anchorY: 0.5,
    })).toEqual({ width: 27, height: 14, offsetX: -13, offsetY: -7 })
  })

  it('uses ceil for vertical column height', () => {
    expect(computeColumnHeight(16, 16)).toBe(1)
    expect(computeColumnHeight(17, 16)).toBe(2)
    expect(computeColumnHeight(33, 16)).toBe(3)
  })

  it('snaps the footprint around the bottom-face center target', () => {
    expect(snapFootprintToBottomCenter({ x: 10, y: 20, z: 2 }, { width: 3, height: 2 })).toEqual({
      x: 9,
      y: 19,
      z: 2,
    })
  })

  it('builds one shared-instance column batch with one anchor', () => {
    const cells = buildObjectInstanceCells({
      origin: { x: 9, y: 19, z: 2 },
      footprint: { width: 3, height: 2 },
      columnHeight: 3,
      token: 'Tree',
      instanceId: 'inst_test',
    })
    expect(cells).toHaveLength(18)
    expect(cells.filter((c) => c.state?.role === 'anchor')).toHaveLength(1)
    expect(new Set(cells.map((c) => c.state?.instanceId))).toEqual(new Set(['inst_test']))
    expect(cells.every((c) => c.token === 'Tree')).toBe(true)
  })

  it('marks the anchor at the target cell when the footprint has an anchor-relative offset', () => {
    const cells = buildObjectInstanceCells({
      origin: { x: 87, y: 193, z: 0 },
      footprint: { width: 27, height: 14, offsetX: -13, offsetY: -7 },
      columnHeight: 1,
      token: 'Hospital',
      instanceId: 'inst_hospital',
    })

    expect(cells).toHaveLength(27 * 14)
    expect(cells.find((c) => c.state?.role === 'anchor')).toMatchObject({
      x: 100,
      y: 200,
      z: 0,
    })
  })

  it('resolveObjectPlacement returns footprint, column, snapped origin and cells in one shot', () => {
    const meta = {
      ppu: 16,
      geometry: { collisionMask: { kind: 'rectangle' as const, x: 0, y: 0, width: 32, height: 32 } },
      objectHeightPx: 32,
    }
    const p = resolveObjectPlacement({ x: 10, y: 20, z: 0 }, meta, 'Tree', () => 'inst_fixed')
    expect(p.footprint).toEqual({ width: 2, height: 2 })
    expect(p.columnHeight).toBe(2)
    // 2x2 footprint snapped to bottom-center of (10,20).
    expect(p.origin).toEqual({ x: 9, y: 19, z: 0 })
    expect(p.cells).toHaveLength(2 * 2 * 2) // w*h*column
    expect(p.cells.every((c) => c.token === 'Tree')).toBe(true)
    expect(new Set(p.cells.map((c) => c.state?.instanceId))).toEqual(new Set(['inst_fixed']))
  })

  it('resolveObjectPlacement footprint width/height drive a non-overlapping box tiling stride', () => {
    const meta = {
      ppu: 16,
      geometry: { collisionMask: { kind: 'rectangle' as const, x: 0, y: 0, width: 48, height: 32 } },
    }
    const p = resolveObjectPlacement({ x: 0, y: 0, z: 0 }, meta, 'Rock', () => 'i')
    // Stride used by box-fill = footprint extents; tiling by it must not overlap.
    const stepX = p.footprint.width
    const stepY = p.footprint.height
    const a = resolveObjectPlacement({ x: 0, y: 0, z: 0 }, meta, 'Rock', () => 'a')
    const b = resolveObjectPlacement({ x: stepX, y: 0, z: 0 }, meta, 'Rock', () => 'b')
    const c = resolveObjectPlacement({ x: 0, y: stepY, z: 0 }, meta, 'Rock', () => 'c')
    const keys = (cells: typeof a.cells) => cells.map((cc) => `${cc.x},${cc.y},${cc.z}`)
    const setA = new Set(keys(a.cells))
    expect(keys(b.cells).some((k) => setA.has(k))).toBe(false)
    expect(keys(c.cells).some((k) => setA.has(k))).toBe(false)
  })
})
