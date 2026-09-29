// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useRenderStore } from '../../../store'
import { RenderCanvas } from '../../../host/RenderCanvas'
beforeEach(() => useRenderStore.getState().reset())
describe('top asset mode', () => {
  it('mounts in asset drawMode without throwing (images absent in jsdom)', () => {
    useRenderStore.getState().setViewMode('top')
    useRenderStore.getState().setDrawMode('asset')
    useRenderStore.getState().setLayers('n', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'grass', type: 'tile' }])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })
})
