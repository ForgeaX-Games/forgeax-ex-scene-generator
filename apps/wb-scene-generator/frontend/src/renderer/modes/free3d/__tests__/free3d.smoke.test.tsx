// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useRenderStore } from '../../../store'
import { RenderCanvas } from '../../../host/RenderCanvas'

beforeEach(() => useRenderStore.getState().reset())

describe('free3d mode', () => {
  it('mounts a voxel layer without throwing (WebGL unavailable in jsdom)', () => {
    useRenderStore.getState().setViewMode('free3d')
    useRenderStore.getState().setLayers('n', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] }], [])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-testid="render-canvas"]')).not.toBeNull()
    expect(container.querySelector('canvas')).not.toBeNull()
  })
})
