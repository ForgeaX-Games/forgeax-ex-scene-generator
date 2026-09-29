import { describe, expect, it } from 'vitest'
import type { DisplayIndex } from '../displayIndex'
import { isGuideActiveForSelection, nearestHostDrawable } from '../guideSelection'

function index(): DisplayIndex {
  return {
    drawables: [
      { id: 'mesh:/Terrain', schema: 'mesh', source: 'mesh', layerKey: 'hf:mesh', path: '/Terrain', label: 'Terrain', nodeId: 'n-terrain' },
      { id: 'guide:/Terrain/Peaks', schema: 'guide', source: 'guide', layerKey: 'pk:points', path: '/Terrain/Peaks', label: 'Peaks', nodeId: 'n-peaks' },
      { id: 'mesh:/Terrain/River', schema: 'mesh', source: 'mesh', layerKey: 'rv:mesh', path: '/Terrain/River', label: 'River', nodeId: 'n-river' },
      { id: 'guide:/Terrain/River/RiverPath', schema: 'guide', source: 'guide', layerKey: 'rp:points', path: '/Terrain/River/RiverPath', label: 'RiverPath', nodeId: 'n-path' },
      { id: 'mesh:/Terrain/Plaza', schema: 'mesh', source: 'mesh', layerKey: 'pl:mesh', path: '/Terrain/Plaza', label: 'Plaza', nodeId: 'n-plaza' },
      { id: 'guide:/Terrain/Plaza/Center', schema: 'guide', source: 'guide', layerKey: 'pc:points', path: '/Terrain/Plaza/Center', label: 'Center', nodeId: 'n-center' },
      { id: 'road:/Terrain/Road', schema: 'road', source: 'mesh', layerKey: 'rd:mesh', path: '/Terrain/Road', label: 'Road', nodeId: 'n-road' },
    ],
  }
}

const peaks = index().drawables[1]!
const riverPath = index().drawables[3]!
const center = index().drawables[5]!

describe('guideSelection', () => {
  it('binds each guide to the nearest mesh host, not the Terrain ancestor', () => {
    const idx = index()
    expect(nearestHostDrawable(peaks.path, idx)?.label).toBe('Terrain')
    expect(nearestHostDrawable(riverPath.path, idx)?.label).toBe('River')
    expect(nearestHostDrawable(center.path, idx)?.label).toBe('Plaza')
  })

  it('does not treat empty selection as highlighting a host', () => {
    const idx = index()
    expect(isGuideActiveForSelection(riverPath, idx, [])).toBe(false)
    expect(isGuideActiveForSelection(peaks, idx, [])).toBe(false)
  })

  it('shows only that structure\'s handles after a mesh click', () => {
    const idx = index()
    expect(isGuideActiveForSelection(riverPath, idx, ['n-river'])).toBe(true)
    expect(isGuideActiveForSelection(peaks, idx, ['n-river'])).toBe(false)
    expect(isGuideActiveForSelection(center, idx, ['n-river'])).toBe(false)

    expect(isGuideActiveForSelection(peaks, idx, ['n-terrain'])).toBe(true)
    expect(isGuideActiveForSelection(riverPath, idx, ['n-terrain'])).toBe(false)

    expect(isGuideActiveForSelection(center, idx, ['n-plaza'])).toBe(true)
    expect(isGuideActiveForSelection(riverPath, idx, ['n-plaza'])).toBe(false)
  })

  it('still shows handles when the guide prim itself is selected in the outliner', () => {
    const idx = index()
    expect(isGuideActiveForSelection(riverPath, idx, ['n-path'])).toBe(true)
    expect(isGuideActiveForSelection(peaks, idx, ['pk:points'])).toBe(true)
  })

  it('does not show handles for a derived mesh with no nested control', () => {
    const idx = index()
    expect(isGuideActiveForSelection(riverPath, idx, ['n-road'])).toBe(false)
    expect(isGuideActiveForSelection(peaks, idx, ['n-road'])).toBe(false)
  })

  it('does not treat a shared scene_output node id as selecting every host', () => {
    const idx: DisplayIndex = {
      drawables: index().drawables.map((d) => ({ ...d, nodeId: 'sink' })),
    }
    expect(isGuideActiveForSelection(idx.drawables[3]!, idx, ['sink'])).toBe(false)
    expect(isGuideActiveForSelection(idx.drawables[3]!, idx, ['rv:mesh'])).toBe(true)
    expect(isGuideActiveForSelection(idx.drawables[1]!, idx, ['rv:mesh'])).toBe(false)
  })
})
