import { describe, it, expect } from 'vitest'
import { gridLayerCellSource, voxelLayerCellSource } from '../cellSource'
import type { GridLayer, RendererVoxelLayer } from '../../types'

const layer: RendererVoxelLayer = {
  key: 'n:/A', nodeId: 'n', nodePath: '/A', nodeName: 'A', value: 1,
  cells: [{ x: 2, y: 3, z: 0 }, { x: 4, y: 1, z: 1 }], visible: true, updatedAt: 0, assetName: '',
}

describe('voxelLayerCellSource', () => {
  it('iterates all cells of a layer as layer-local col/row/value/z', () => {
    const src = voxelLayerCellSource(layer)
    // bbox: minX=2, minY=1 → worldOffset (2,1); cols=3, rows=3
    expect(src).toMatchObject({ cols: 3, rows: 3, worldOffsetX: 2, worldOffsetY: 1, isMultiValue: false })
    const seen: Array<{ col: number; row: number; value: number; z?: number }> = []
    src.iterCells((c) => seen.push({ col: c.col, row: c.row, value: c.value, z: c.z }))
    expect(seen).toHaveLength(2)
    // cell (2,3,0) → layer-local (col 0, row 2); cell (4,1,1) → (col 2, row 0)
    expect(seen[0]).toMatchObject({ col: 0, row: 2, value: 1, z: 0 })
    expect(seen[1]).toMatchObject({ col: 2, row: 0, value: 1, z: 1 })
  })
})

describe('gridLayerCellSource', () => {
  const grid: GridLayer = {
    key: 'n:grid', nodeId: 'n', portName: 'grid', nodeName: 'Noise',
    // data[row][col]; 0 = empty cell (skipped)
    data: [
      [0, 2],
      [1, 0],
    ],
    rows: 2, cols: 2, outputType: 'grid', visible: true, updatedAt: 0,
  }

  it('iterates only non-zero cells as [row][col], offset (0,0)', () => {
    const src = gridLayerCellSource(grid)
    expect(src).toMatchObject({ cols: 2, rows: 2, worldOffsetX: 0, worldOffsetY: 0 })
    const seen: Array<{ col: number; row: number; value: number }> = []
    src.iterCells((c) => seen.push({ col: c.col, row: c.row, value: c.value }))
    // (row0,col1)=2 and (row1,col0)=1; the two zeros are skipped
    expect(seen).toHaveLength(2)
    expect(seen).toContainEqual({ col: 1, row: 0, value: 2 })
    expect(seen).toContainEqual({ col: 0, row: 1, value: 1 })
  })

  it('flags isMultiValue when distinct non-zero values exceed one', () => {
    expect(gridLayerCellSource(grid).isMultiValue).toBe(true)
    const binary: GridLayer = { ...grid, data: [[0, 1], [1, 1]] }
    expect(gridLayerCellSource(binary).isMultiValue).toBe(false)
  })
})
