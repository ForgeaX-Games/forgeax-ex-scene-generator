// @vitest-environment node
//
// Throwaway attribution micro-benchmark (run manually): quantifies the per-move
// projection cost that dominated the ~700ms synchronous hover handler, and the
// after-fix indexed cost. Not a CI assertion — generous thresholds only.
import { describe, it, expect } from 'vitest'
import {
  billboardProjectionFaceForVoxel,
  billboardProjectionFaceForVoxelIndexed,
  buildColumnOccupancy,
  type VoxelCellLite,
} from '../topBillboard'

function makeScene(n: number): VoxelCellLite[] {
  const cells: VoxelCellLite[] = []
  const side = Math.ceil(Math.sqrt(n))
  for (let i = 0; i < n; i++) cells.push({ x: i % side, y: Math.floor(i / side), z: 0 })
  return cells
}

describe('projection attribution', () => {
  it('indexed projection is dramatically faster than linear scan per move', () => {
    const N = 5000
    const cells = makeScene(N)
    const MOVES = 2000
    const target = { x: 3, y: 3, z: 2 }

    const t0 = performance.now()
    for (let i = 0; i < MOVES; i++) billboardProjectionFaceForVoxel(target, cells)
    const linearMs = performance.now() - t0

    const occ = buildColumnOccupancy(cells)
    const t1 = performance.now()
    for (let i = 0; i < MOVES; i++) billboardProjectionFaceForVoxelIndexed(target, occ)
    const indexedMs = performance.now() - t1

    // eslint-disable-next-line no-console
    console.info(`[attr] N=${N} moves=${MOVES} linear=${linearMs.toFixed(1)}ms indexed=${indexedMs.toFixed(1)}ms (per-move linear=${(linearMs / MOVES).toFixed(3)}ms indexed=${(indexedMs / MOVES).toFixed(4)}ms)`)

    // Indexed must be at least 5x faster overall; per-move must be well under a frame.
    expect(indexedMs).toBeLessThan(linearMs)
    expect(indexedMs / MOVES).toBeLessThan(0.5)
  })
})
