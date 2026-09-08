import { describe, expect, it } from 'vitest'
import {
  billboardEditVoxelFromTopFaceCell,
  billboardEditVoxelFromFrontFaceCell,
  billboardProjectionFaceForVoxel,
  billboardFrontFaceCellForVoxel,
  billboardTopFaceCellForVoxel,
  billboardObjectAnchorCanvasXY,
  billboardObjectFootprintPreview,
} from '../topBillboard'
import { snapFootprintToBottomCenter } from '../objectPlacement'

describe('top billboard edit geometry', () => {
  it('maps the selected top-face grid cell to the voxel painted at the requested z layer', () => {
    expect(billboardEditVoxelFromTopFaceCell({ col: 4, row: 7 }, 0)).toEqual({ x: 4, y: 8, z: 0 })
    expect(billboardEditVoxelFromTopFaceCell({ col: 4, row: 7 }, 2)).toEqual({ x: 4, y: 10, z: 2 })
  })

  it('round-trips a voxel back to the top-face grid cell the user selected', () => {
    expect(billboardTopFaceCellForVoxel({ x: 4, y: 8, z: 0 })).toEqual({ col: 4, row: 7 })
    expect(billboardTopFaceCellForVoxel({ x: 4, y: 10, z: 2 })).toEqual({ col: 4, row: 7 })
  })

  it('maps the selected front/bottom grid cell to the voxel painted at the requested z layer', () => {
    expect(billboardEditVoxelFromFrontFaceCell({ col: 4, row: 7 }, 0)).toEqual({ x: 4, y: 7, z: 0 })
    expect(billboardEditVoxelFromFrontFaceCell({ col: 4, row: 7 }, 2)).toEqual({ x: 4, y: 9, z: 2 })
  })

  it('round-trips a voxel back to the front/bottom grid cell the user selected', () => {
    expect(billboardFrontFaceCellForVoxel({ x: 4, y: 7, z: 0 })).toEqual({ col: 4, row: 7 })
    expect(billboardFrontFaceCellForVoxel({ x: 4, y: 9, z: 2 })).toEqual({ col: 4, row: 7 })
  })

  it('finds the nearest lower voxel top face for placement projection', () => {
    expect(billboardProjectionFaceForVoxel(
      { x: 4, y: 9, z: 3 },
      [
        { x: 4, y: 9, z: 0 },
        { x: 4, y: 9, z: 2 },
        { x: 4, y: 8, z: 2 },
      ],
    )).toEqual({
      kind: 'voxel',
      cell: { col: 4, row: 6 },
      support: { x: 4, y: 9, z: 2 },
    })
  })

  it('falls back to a ground projection when there is no lower voxel', () => {
    expect(billboardProjectionFaceForVoxel(
      { x: 4, y: 9, z: 3 },
      [{ x: 4, y: 9, z: 4 }],
    )).toEqual({ kind: 'ground', cell: { col: 4, row: 9 } })
  })

  it('anchors object sprites to the voxel footprint instead of the raised top face', () => {
    expect(billboardObjectAnchorCanvasXY(
      { x: 2, y: 3, z: 0 },
      { cols: 1, rows: 2, worldOffsetX: 2, worldOffsetY: 2 },
      8,
    )).toEqual({ x: 0, y: 8 })
  })

  it('snaps object footprints around the bottom-face edit target', () => {
    const target = billboardEditVoxelFromFrontFaceCell({ col: 10, row: 20 }, 2)

    expect(snapFootprintToBottomCenter(target, { width: 3, height: 2 })).toEqual({
      x: 9,
      y: 21,
      z: 2,
    })
  })

  it('previews every occupied and projected face for an object footprint', () => {
    const preview = billboardObjectFootprintPreview(
      { x: 10, y: 22, z: 2 },
      { width: 3, height: 2 },
      [
        { x: 9, y: 21, z: 0 },
        { x: 10, y: 21, z: 1 },
        { x: 11, y: 21, z: 0 },
        { x: 9, y: 22, z: 1 },
        { x: 10, y: 22, z: 0 },
        { x: 11, y: 22, z: 1 },
      ],
    )

    expect(preview.origin).toEqual({ x: 9, y: 21, z: 2 })
    expect(preview.cells.map((cell) => cell.voxel)).toEqual([
      { x: 9, y: 21, z: 2 },
      { x: 10, y: 21, z: 2 },
      { x: 11, y: 21, z: 2 },
      { x: 9, y: 22, z: 2 },
      { x: 10, y: 22, z: 2 },
      { x: 11, y: 22, z: 2 },
    ])
    expect(preview.cells.map((cell) => cell.targetFace)).toEqual([
      { col: 9, row: 19 },
      { col: 10, row: 19 },
      { col: 11, row: 19 },
      { col: 9, row: 20 },
      { col: 10, row: 20 },
      { col: 11, row: 20 },
    ])
    expect(preview.cells.map((cell) => cell.projection.cell)).toEqual([
      { col: 9, row: 20 },
      { col: 10, row: 19 },
      { col: 11, row: 20 },
      { col: 9, row: 20 },
      { col: 10, row: 21 },
      { col: 11, row: 20 },
    ])
  })

  it('previews object footprints with the collision mask offset preserved relative to the anchor', () => {
    const target = { x: 100, y: 200, z: 0 }
    const preview = billboardObjectFootprintPreview(
      target,
      { width: 28, height: 14, offsetX: -14, offsetY: -7 },
      [],
    )

    expect(preview.origin).toEqual({ x: 86, y: 193, z: 0 })
    expect(preview.cells).toHaveLength(28 * 14)
    expect(preview.cells.map((cell) => cell.voxel)).toContainEqual(target)
    expect(preview.cells[0]?.voxel).toEqual({ x: 86, y: 193, z: 0 })
    expect(preview.cells.at(-1)?.voxel).toEqual({ x: 113, y: 206, z: 0 })
  })
})
