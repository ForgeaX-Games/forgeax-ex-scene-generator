import { describe, it, expect } from 'vitest'
import { renderToPng } from '../renderToPng'
import type { RendererVoxelLayer } from '../../types'

const layer: RendererVoxelLayer = {
  key: 'n:/A', nodeId: 'n', nodePath: '/A', nodeName: 'A', value: 1,
  cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }],
  visible: true, updatedAt: 0, assetName: '',
}

describe('renderToPng (server, iso)', () => {
  it('produces a valid PNG buffer with no browser', async () => {
    const png = await renderToPng([layer], { mode: 'iso', drawMode: 'color' })
    expect(png.length).toBeGreaterThan(100)
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
  })
})

describe('renderToPng (server, top + topBillboard)', () => {
  it('renders top wire/color to a PNG', async () => {
    const png = await renderToPng([layer], { mode: 'top', drawMode: 'color' })
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.length).toBeGreaterThan(100)
  })
  it('renders topBillboard to a PNG', async () => {
    const png = await renderToPng([layer], { mode: 'topBillboard', drawMode: 'color' })
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
  })
  it('asset mode with no image resolver degrades to color without throwing', async () => {
    const png = await renderToPng(
      [{ ...layer, assetName: 'grass', assetType: 'tile' }],
      { mode: 'topBillboard', drawMode: 'asset' },
    )
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
  })
})
