import { describe, expect, it } from 'vitest'
import { painterSort } from './collect'
import type { CollectedCell } from './types'

function cell(label: string, y: number, z: number, layerIdx = 0): CollectedCell {
  return {
    x: 0,
    y,
    z,
    value: label.charCodeAt(0),
    layerIdx,
    isSelected: false,
    isEditorSelected: false,
    isMultiValue: false,
  }
}

describe('topBillboard painterSort', () => {
  it('orders cells by raw y before z and layer index', () => {
    const floorSameDepth = cell('A', 2, 0)
    const elevatedObject = cell('B', 1, 1)
    const foregroundFloor = cell('C', 3, 0)
    const laterLayerSameYAndZ = cell('D', 2, 0, 1)
    const visible = [foregroundFloor, laterLayerSameYAndZ, elevatedObject, floorSameDepth]

    painterSort(visible)

    expect(visible).toEqual([elevatedObject, floorSameDepth, laterLayerSameYAndZ, foregroundFloor])
  })
})
