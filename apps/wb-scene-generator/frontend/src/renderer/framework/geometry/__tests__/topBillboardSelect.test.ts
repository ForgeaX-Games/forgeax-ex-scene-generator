import { describe, it, expect } from 'vitest'
import {
  buildColumnOccupancy,
  addCellsToColumnOccupancy,
  billboardVoxelStackAtScreenCell,
  billboardTopFaceCellForVoxel,
  billboardFrontFaceCellForVoxel,
  type VoxelCellLite,
} from '../topBillboard'

// SELECT-tool multi-voxel hit-test. A single screen cell can be covered by
// several voxels (different heights along one screen column project onto it).
// The stack must come back VISUALLY top-most first — the order the painter
// stacks pixels (column z ASC, top cap before front wall) — so the SELECT tool
// picks what the user sees on top and cycles to progressively-lower voxels.
describe('billboardVoxelStackAtScreenCell (SELECT hit-test)', () => {
  it('returns every voxel whose top/front face covers a screen cell, top-most first', () => {
    // A stacked column at x=2: z=0 and z=1 (a ground voxel and a wall above it).
    //   z=0 → top@(2, y-z-1)=(2,2) front@(2, y-z)=(2,3)
    //   z=1 → top@(2,1)        front@(2,2)
    // Screen cell (col=2, row=2) is therefore covered by BOTH z=0's top cap AND
    // z=1's front wall. The front wall of the upper voxel paints over the lower
    // voxel's cap, so z=1 must come first.
    const cells: VoxelCellLite[] = [
      { x: 2, y: 3, z: 0 },
      { x: 2, y: 3, z: 1 },
    ]
    const occ = buildColumnOccupancy(cells)
    const stack = billboardVoxelStackAtScreenCell(occ, 2, 2)
    expect(stack).toHaveLength(2)
    expect(stack[0]).toEqual({ voxel: { x: 2, y: 3, z: 1 }, face: 'front' })
    expect(stack[1]).toEqual({ voxel: { x: 2, y: 3, z: 0 }, face: 'top' })
  })

  it('reports the face hit and matches the projection helpers', () => {
    const cell: VoxelCellLite = { x: 5, y: 4, z: 2 }
    const occ = buildColumnOccupancy([cell])
    const top = billboardTopFaceCellForVoxel(cell)
    const front = billboardFrontFaceCellForVoxel(cell)
    // The top cap lands on its top-face screen cell…
    expect(billboardVoxelStackAtScreenCell(occ, top.col, top.row)).toEqual([{ voxel: cell, face: 'top' }])
    // …and the front wall on its front-face screen cell.
    expect(billboardVoxelStackAtScreenCell(occ, front.col, front.row)).toEqual([{ voxel: cell, face: 'front' }])
  })

  it('only enumerates voxels in the queried screen column (uses byX index)', () => {
    const cells: VoxelCellLite[] = [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ]
    const occ = buildColumnOccupancy(cells)
    // top of (2,0,0) is at (col=2, row=-1); the neighbouring columns must not leak.
    const stack = billboardVoxelStackAtScreenCell(occ, 2, -1)
    expect(stack).toEqual([{ voxel: { x: 2, y: 0, z: 0 }, face: 'top' }])
  })

  it('returns an empty stack for an empty screen cell', () => {
    const occ = buildColumnOccupancy([{ x: 0, y: 0, z: 0 }])
    expect(billboardVoxelStackAtScreenCell(occ, 99, 99)).toEqual([])
  })

  it('orders a deep stack strictly by paint rank (higher z / front wall on top)', () => {
    // Three voxels stacked at x=0: z=0,1,2 (y=2 each so their faces overlap on
    // screen). Screen cell (0,0): z=0 front@(0,2)? no. We pick a row covered by
    // multiple: voxel z=k → top@(0, 2-k-1), front@(0, 2-k).
    //   z=0: top@(0,1) front@(0,2)
    //   z=1: top@(0,0) front@(0,1)
    //   z=2: top@(0,-1) front@(0,0)
    // Row 1 is z=0.top AND z=1.front → z=1.front (rank 3) over z=0.top (rank 0).
    const cells: VoxelCellLite[] = [
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 2, z: 1 },
      { x: 0, y: 2, z: 2 },
    ]
    const occ = buildColumnOccupancy(cells)
    const stack = billboardVoxelStackAtScreenCell(occ, 0, 1)
    expect(stack.map((h) => `${h.voxel.z}:${h.face}`)).toEqual(['1:front', '0:top'])
  })
})

// Incremental occupancy: a paint touches only k new cells; feeding them into the
// existing index must yield the SAME structure as a full rebuild (otherwise the
// hover hit-test would drift), be idempotent on duplicate replays, and keep each
// column z-ascending. This is what lets a paint update occupancy in O(k) instead
// of re-scanning all N cells per painted cell (the ~375ms regression).
describe('addCellsToColumnOccupancy (incremental occupancy update)', () => {
  function normalize(occ: ReturnType<typeof buildColumnOccupancy>) {
    const cols: Record<string, Array<[number, number, number]>> = {}
    for (const [k, arr] of occ.byColumn) cols[k] = arr.map((c) => [c.x, c.y, c.z])
    const xs: Record<number, number> = {}
    for (const [x, arr] of occ.byX) xs[x] = arr.length
    return { cols, xs }
  }

  it('matches a full rebuild after adding cells incrementally', () => {
    const initial: VoxelCellLite[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 1, y: 0, z: 0 },
    ]
    const added: VoxelCellLite[] = [
      { x: 0, y: 0, z: 1 }, // inserts BETWEEN z=0 and z=2 → tests binary insert
      { x: 5, y: 9, z: 3 }, // brand-new column
      { x: 1, y: 0, z: 4 },
    ]
    const incremental = buildColumnOccupancy(initial)
    addCellsToColumnOccupancy(incremental, added)
    const full = buildColumnOccupancy([...initial, ...added])
    expect(normalize(incremental)).toEqual(normalize(full))
    // Column z-order preserved by the binary insert.
    expect(incremental.byColumn.get('0,0')!.map((c) => c.z)).toEqual([0, 1, 2])
  })

  it('is idempotent: re-adding an existing cell does not duplicate it', () => {
    const occ = buildColumnOccupancy([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }])
    addCellsToColumnOccupancy(occ, [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }])
    expect(occ.byColumn.get('0,0')!.map((c) => c.z)).toEqual([0, 1])
    expect(occ.byX.get(0)!.length).toBe(2)
  })
})
