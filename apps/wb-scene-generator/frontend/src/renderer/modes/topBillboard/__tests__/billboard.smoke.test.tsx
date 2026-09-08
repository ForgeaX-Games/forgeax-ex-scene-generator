// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useRenderStore } from '../../../store'
import { RenderCanvas } from '../../../host/RenderCanvas'

beforeEach(() => useRenderStore.getState().reset())

describe('billboard mode', () => {
  it('mounts and renders a voxel layer without throwing', () => {
    useRenderStore.getState().setViewMode('topBillboard')
    useRenderStore.getState().setLayers('n', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] }], [])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-testid="render-canvas"]')).not.toBeNull()
    expect(container.querySelector('canvas')).not.toBeNull()
  })
})
