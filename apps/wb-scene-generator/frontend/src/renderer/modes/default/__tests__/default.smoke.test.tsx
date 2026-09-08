// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useRenderStore } from '../../../store'
import { RenderCanvas } from '../../../host/RenderCanvas'

beforeEach(() => useRenderStore.getState().reset())
afterEach(() => cleanup())

describe('default mode', () => {
  it('mounts voxel + grid layers without throwing (WebGL unavailable in jsdom)', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setLayers('n', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] }], [])
    useRenderStore.getState().setPreviewLayer('noise', 'grid', 'Noise', [[0, 1], [1, 0]])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-testid="render-canvas"]')).not.toBeNull()
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('mounts an intermediate all-zero grid with no scene_output', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setPreviewLayer('noise', 'grid', 'Noise', [[0, 0], [0, 0]])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
  })

  it('mounts a terrain mesh layer without throwing (WebGL unavailable in jsdom)', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setMeshLayer('hf', 'mesh', 'HeightfieldMesh', {
      positions: [0, 0, 0, 1, 0, 0, 0, -1, 1],
      indices: [0, 1, 2],
    })
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
  })

  it('mounts a guide polyline independently of the road mesh', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setGuideLayer('gd', 'points', 'PointsToNode', [
      { x: 6, y: 24 }, { x: 18, y: 20 }, { x: 30, y: 26 }, { x: 42, y: 22 },
    ])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
  })

  it('mounts house boxes independently of terrain and road', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setMeshLayer('hx', 'mesh', 'GridToBoxes', {
      positions: [0, 0, 0, 1, 0, 0, 1, -1, 3, 0, -1, 3],
      indices: [0, 1, 2, 0, 2, 3],
      role: 'houses',
      color: [0.96, 0.96, 0.94],
    })
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
  })

  it('mounts a road strip mesh independently of terrain', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setMeshLayer('rd', 'mesh', 'StrokeToMesh', {
      positions: [0, 0, 0.1, 2, 0, 0.1, 0, -1, 0.1],
      indices: [0, 1, 2],
      role: 'road',
    })
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
  })

  it('shows a Stage debug HUD for triangle / object counts', () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-testid="stage-hud"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="stage-hud"]')?.textContent).toMatch(/tri/)
  })

  it('survives reset() while Default stays mounted (voxel list shrinks to empty)', () => {
    useRenderStore.getState().setViewMode('default')
    useRenderStore.getState().setLayers('n', 'scene_output',
      [{ nodePath: '/A', nodeName: 'A', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }], [])
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
    act(() => { useRenderStore.getState().reset() })
    expect(useRenderStore.getState().viewMode).toBe('default')
    expect(container.querySelector('[data-mode="default"]')).not.toBeNull()
  })
})
