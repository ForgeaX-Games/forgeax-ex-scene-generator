// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { RendererSurface } from '../RendererSurface'
import { AssetStoreSurface } from '../AssetStoreSurface'
import { useRenderStore } from '../../renderer/store'
import { useAssetStoreStore, RULES_ZONE } from '../library/assetStoreStore'
import { readSelectedRule } from '../library/rulesApi'
import type { HttpApiClient } from '../../api/HttpApiClient'
import { ensureSceneI18n } from '../../sceneI18n.js'

// Mock the heavy RenderCanvas (WebGL/2D plugin host) with a light stub that
// publishes a fake PluginHandle into the parent's handleRef — exactly the §7.3
// screenshot protocol the real plugins expose (renderFrame + getFrameCanvas).
// This lets the screenshot test drive the SAME render API the surface reuses,
// without standing up a real renderer in jsdom.
const SHOT_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const renderFrameMock = vi.fn()
vi.mock('../../renderer/host/RenderCanvas.js', () => ({
  RenderCanvas: ({ handleRef }: { handleRef?: { current: unknown } }) => {
    if (handleRef) {
      const canvas = { width: 320, height: 200, toDataURL: () => SHOT_DATA_URL } as unknown as HTMLCanvasElement
      handleRef.current = {
        renderFrame: renderFrameMock,
        getFrameCanvas: () => canvas,
      }
    }
    return null
  },
}))

// A fake ApiClient with just the surface the renderer/assetstore consume.
function fakeClient(options?: {
  nodes?: Array<{ id: string; opId: string; params?: Record<string, unknown> }>
  functions?: Array<{
    functionName: string
    opId?: string
    inputs: Array<{ name: string; type: string; mode?: 'value' | 'parameter'; control?: boolean; defaultValue?: unknown; label?: string }>
    outputs: unknown[]
  }>
}): HttpApiClient {
  const nodes = options?.nodes ?? []
  const functions = options?.functions ?? []
  return {
    subscribe: () => () => {},
    subscribeRaw: () => () => {},
    async ensureViewingProject() {
      return 'main'
    },
    async listOps() {
      return []
    },
    async listNodes() {
      return nodes
    },
    async getSceneScriptContracts() {
      return { version: '0.1', functions }
    },
    async getNodeOutput() {
      return undefined
    },
    async getNodeOutputsBatch() {
      return {}
    },
  } as unknown as HttpApiClient
}

function fakeClientWithControls(): HttpApiClient {
  return fakeClient({
    nodes: [
      { id: 'n_hill', opId: 'hill_contour_generate', params: { seed: 1 } },
      { id: 'n_boxes', opId: 'grid_to_boxes', params: { buildingHeight: 3 } },
    ],
    functions: [
      {
        functionName: 'hillContourGenerate',
        opId: 'hill_contour_generate',
        inputs: [
          { name: 'seed', type: 'number', mode: 'parameter', control: true, defaultValue: 1, label: 'Seed' },
        ],
        outputs: [],
      },
      {
        functionName: 'gridToBoxes',
        opId: 'grid_to_boxes',
        inputs: [
          { name: 'buildingHeight', type: 'number', mode: 'parameter', control: true, defaultValue: 3, label: 'Building height' },
        ],
        outputs: [],
      },
    ],
  })
}

beforeEach(() => {
  ensureSceneI18n()
  localStorage.clear()
  useRenderStore.getState().reset()
  // Do not change the product default viewMode here. Tests that need 2D chrome
  // (Scene Preview label / zoom) explicitly select a 2D mode.
  for (const mode of ['default', 'top', 'topBillboard', 'iso', 'free3d', '3DMesh'] as const) {
    useRenderStore.getState().setViewGuideVisible(mode, false)
  }
  renderFrameMock.mockClear()
  if (!HTMLElement.prototype.scrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    })
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'featurePolicy')
  Reflect.deleteProperty(document, 'permissionsPolicy')
})

function fetchUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

async function waitForRenameFocus(getByLabelText: (label: string) => HTMLElement): Promise<void> {
  await waitFor(async () => {
    const input = getByLabelText('Rename editable layer')
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    expect(input).toBe(document.activeElement)
  })
}

async function openDrawer(container: HTMLElement, title: string): Promise<void> {
  const button = container.querySelector(`.renderer-drawer-pill button[title="${title}"]`) as HTMLButtonElement
  await act(async () => { fireEvent.click(button) })
}

/** Let useNodePreviews finish its mount refresh (which GCs layers). */
async function flushPreviewRefresh(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('RendererSurface', () => {
  it('renders the canvas preview label and tool capsule drawers', () => {
    // Product default is Default (orbit 3D, no 2D preview chrome); select a 2D mode for this case.
    useRenderStore.getState().setViewMode('top')
    const { container, getByLabelText, queryByText } = render(<RendererSurface client={fakeClient()} />)
    expect(getByLabelText('Scene Preview')).toBeTruthy()
    expect(queryByText('Scene Preview')).toBeNull()
    expect(container.querySelector('[data-forgeax-headless-renderer="wb-scene-generator"]')).not.toBeNull()
    expect(container.querySelector('[data-pane="renderer"]')).not.toBeNull()
    expect(container.querySelector('.renderer-drawer-pill')).not.toBeNull()
    expect(container.querySelector('.renderer-preview-label__zoom output')?.textContent).toMatch(/%$/)
    expect(container.querySelector('.renderer-layers')).toBeNull()
    expect(container.querySelector('.renderer-drawer-pill button[title="Editable"]')).not.toBeNull()
    expect(container.querySelector('.renderer-drawer-pill button[title="Output"]')).not.toBeNull()
    // No execution affordance leaks into the renderer chrome.
    expect(container.textContent).not.toMatch(/\b(Run|Execute|Play|Stop)\b/)
    // View/draw controls live in the Effects drawer, not a top toolbar.
    expect(container.querySelector('.renderer-toolbar')).toBeNull()
  })

  it('hides the 2D zoom chrome completely in 3D modes', () => {
    useRenderStore.getState().setViewMode('free3d')
    const free3d = render(<RendererSurface client={fakeClient()} />)
    expect(free3d.queryByLabelText('Scene Preview')).toBeNull()
    free3d.unmount()

    useRenderStore.getState().setViewMode('3DMesh')
    const mesh = render(<RendererSurface client={fakeClient()} />)
    expect(mesh.queryByLabelText('Scene Preview')).toBeNull()
    mesh.unmount()

    useRenderStore.getState().setViewMode('default')
    const def = render(<RendererSurface client={fakeClient()} />)
    expect(def.queryByLabelText('Scene Preview')).toBeNull()
  })

  it('opens the baked voxel GLB export dialog from Output', async () => {
    const bakedLayers = [
      {
        nodePath: '/Floor',
        nodeName: 'Floor',
        value: 1,
        assetName: '',
        cells: [{ x: 0, y: 0, z: 0 }],
        attributes: {},
      },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ layers: bakedLayers }), { status: 200 })))
    useRenderStore.getState().setBakedLayers(bakedLayers)

    const { container, getByRole } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Output')
    const button = getByRole('button', { name: 'Export voxel GLB' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)

    expect(getByRole('dialog', { name: 'Export voxel GLB' })).toBeTruthy()
    expect((getByRole('textbox', { name: 'Project-relative destination directory' }) as HTMLInputElement).value).toBe('assets/3d')
    expect((getByRole('textbox', { name: 'GLB filename' }) as HTMLInputElement).value).toBe('baked-voxel-scene.glb')
  })

  it('opens the Effects drawer from the tool capsule and exposes view/draw controls', async () => {
    // Guides toggle keys off the active 2D view mode; select top explicitly.
    useRenderStore.getState().setViewMode('top')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    const effectsButton = container.querySelector('.renderer-drawer-pill button[title="Effects"]') as HTMLButtonElement
    await act(async () => { fireEvent.click(effectsButton) })
    const drawer = container.querySelector('.renderer-drawer-panel.is-open') as HTMLElement
    expect(drawer).not.toBeNull()
    const drawerQueries = within(drawer)
    expect(drawerQueries.getByText('Billboard')).toBeTruthy()
    expect(drawer.querySelectorAll('.renderer-effects-grid--views button')).toHaveLength(6)
    expect(drawer.querySelectorAll('.renderer-effects-section--controls')).toHaveLength(1)
    expect(drawer.querySelectorAll('.renderer-effects-draw-capsule button')).toHaveLength(3)
    expect(drawerQueries.queryByText('Draw mode')).toBeNull()
    const viewButtons = drawer.querySelectorAll('.renderer-effects-grid button')
    expect(viewButtons[0]?.textContent).toBe('Default')
    expect(drawerQueries.getByText('Wire')).toBeTruthy()
    expect(drawerQueries.getByText('Color')).toBeTruthy()
    expect(drawerQueries.getByText('Asset')).toBeTruthy()
    const guides = drawerQueries.getByRole('button', { name: 'Show grid and axes' })
    expect(guides.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(guides)
    expect(useRenderStore.getState().viewGuides.top).toBe(true)
    fireEvent.click(drawerQueries.getByText('Billboard'))
    expect(guides.getAttribute('aria-pressed')).toBe('false')
    expect(drawerQueries.getAllByText('Effects')).toHaveLength(1)
    expect(drawerQueries.getAllByText('View')).toHaveLength(1)
    expect(useRenderStore.getState().viewMode).toBe('topBillboard')
    expect(drawerQueries.getByText('Billboard').classList.contains('is-active')).toBe(true)
  })

  it('closes an open drawer before requesting the Node Editor', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Effects')
    expect(container.querySelector('.renderer-drawer-panel.is-open')).not.toBeNull()

    const editorButton = container.querySelector(
      '.renderer-drawer-pill button[title="Node Editor"]',
    ) as HTMLButtonElement
    await act(async () => { fireEvent.click(editorButton) })

    expect(container.querySelector('.renderer-drawer-panel.is-open')).toBeNull()
  })

  it('closes an unpinned drawer outside but keeps a pinned drawer open', async () => {
    const { container, getByLabelText } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Effects')

    fireEvent.pointerDown(document.body)
    expect(container.querySelector('.renderer-drawer-panel.is-open')).toBeNull()

    await openDrawer(container, 'Effects')
    fireEvent.click(getByLabelText('Pin drawer'))
    expect(getByLabelText('Unpin drawer').getAttribute('aria-pressed')).toBe('true')

    fireEvent.pointerDown(document.body)
    expect(container.querySelector('.renderer-drawer-panel.is-open')).not.toBeNull()

    fireEvent.click(getByLabelText('Unpin drawer'))
    fireEvent.pointerDown(document.body)
    expect(container.querySelector('.renderer-drawer-panel.is-open')).toBeNull()
  })

  it('lists ONLY scene_output voxel layers — grid previews stay on canvas, never in the panel', async () => {
    // Default Output lists Grid rows; this contract is for specialized (non-Default) modes.
    useRenderStore.getState().setViewMode('3DMesh')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    // Seed both buckets after mount refresh GC: grid preview + voxel sink layer.
    useRenderStore.getState().setPreviewLayer('noise', 'grid', 'cellular_noise', [[0, 1], [1, 0]], 'grid')
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    await openDrawer(container, 'Output')
    const rows = container.querySelectorAll('.renderer-layers-drawer .renderer-layer-row')
    // Exactly one row — the voxel layer. The grid preview is rendered on canvas only.
    expect(rows).toHaveLength(1)
    expect(container.querySelector('.renderer-layers-drawer')?.textContent).toContain('Wall')
    expect(container.querySelector('.renderer-layers-drawer')?.textContent).not.toContain('cellular_noise')
  })

  it('in Default mode, Output splits Voxel and Grid groups with independent eyes', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setPreviewLayer('noise', 'grid', 'cellular_noise', [[0, 1], [1, 0]], 'grid')
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    await openDrawer(container, 'Output')
    const voxelGroup = container.querySelector('[data-schema="voxel"]') as HTMLElement
    const gridGroup = container.querySelector('[data-schema="grid"]') as HTMLElement
    expect(voxelGroup).not.toBeNull()
    expect(gridGroup).not.toBeNull()
    expect(within(voxelGroup).getByText('Wall')).toBeTruthy()
    expect(within(voxelGroup).getByText('voxel')).toBeTruthy()
    expect(voxelGroup.querySelector('[data-schema-badge="voxel"]')?.textContent).toBe('voxel')
    expect(within(gridGroup).getByText('cellular_noise.grid')).toBeTruthy()
    expect(gridGroup.querySelector('[data-schema-badge="grid"]')?.textContent).toBe('grid')
    expect(within(gridGroup).getByText('2×2')).toBeTruthy()
    fireEvent.click(within(voxelGroup).getByRole('button', { name: 'Hide Voxel layers' }))
    expect(useRenderStore.getState().schemaVisible.voxel).toBe(false)
    expect(useRenderStore.getState().schemaVisible.grid).toBe(true)
    fireEvent.click(within(gridGroup).getByRole('button', { name: 'Hide Grid layers' }))
    expect(useRenderStore.getState().schemaVisible.grid).toBe(false)
    expect(voxelGroup.classList.contains('is-hidden')).toBe(true)
  })

  it('in Default mode, Output shows a Mesh group with a mesh badge independent of Voxel', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    useRenderStore.getState().setMeshLayer('hf', 'mesh', 'HeightfieldMesh', {
      positions: [0, 0, 0, 1, 0, 0, 0, -1, 1, 1, -1, 1],
      indices: [0, 1, 2, 1, 3, 2],
      color: [0.82, 0.82, 0.8],
    })
    await openDrawer(container, 'Output')
    const meshGroup = container.querySelector('[data-schema="mesh"]') as HTMLElement
    expect(meshGroup).not.toBeNull()
    expect(within(meshGroup).getByText('Mesh')).toBeTruthy()
    expect(meshGroup.querySelector('[data-schema-badge="mesh"]')?.textContent).toBe('mesh')
    expect(within(meshGroup).getByText('HeightfieldMesh.mesh')).toBeTruthy()
    fireEvent.click(within(container.querySelector('[data-schema="voxel"]') as HTMLElement).getByRole('button', { name: 'Hide Voxel layers' }))
    expect(useRenderStore.getState().schemaVisible.voxel).toBe(false)
    expect(useRenderStore.getState().schemaVisible.mesh).toBe(true)
    expect(meshGroup.classList.contains('is-hidden')).toBe(false)
  })

  it('in Default mode, Output shows a Road group independent of Mesh', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setMeshLayer('hf', 'mesh', 'HeightfieldMesh', {
      positions: [0, 0, 0, 1, 0, 0, 0, -1, 1],
      indices: [0, 1, 2],
    })
    useRenderStore.getState().setMeshLayer('rd', 'mesh', 'StrokeToMesh', {
      positions: [0, 0, 0.1, 1, 0, 0.1, 0, -1, 0.1],
      indices: [0, 1, 2],
      role: 'road',
      color: [0.93, 0.9, 0.78],
    })
    await openDrawer(container, 'Output')
    const roadGroup = container.querySelector('[data-schema="road"]') as HTMLElement
    expect(roadGroup).not.toBeNull()
    expect(within(roadGroup).getByText('Road')).toBeTruthy()
    expect(roadGroup.querySelector('[data-schema-badge="road"]')?.textContent).toBe('road')
    fireEvent.click(within(container.querySelector('[data-schema="mesh"]') as HTMLElement).getByRole('button', { name: 'Hide Mesh layers' }))
    expect(useRenderStore.getState().schemaVisible.mesh).toBe(false)
    expect(useRenderStore.getState().schemaVisible.road).toBe(true)
    expect(roadGroup.classList.contains('is-hidden')).toBe(false)
  })

  it('in Default mode, Output shows a Boxes group independent of Mesh', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setMeshLayer('hf', 'mesh', 'HeightfieldMesh', {
      positions: [0, 0, 0, 1, 0, 0, 1, -1, 3],
      indices: [0, 1, 2],
    })
    useRenderStore.getState().setMeshLayer('hx', 'mesh', 'GridToBoxes', {
      positions: [0, 0, 0, 1, 0, 0, 1, -1, 3, 0, -1, 3],
      indices: [0, 1, 2, 0, 2, 3],
      role: 'houses',
      color: [0.96, 0.96, 0.94],
    })
    await openDrawer(container, 'Output')
    const houseGroup = container.querySelector('[data-schema="houses"]') as HTMLElement
    expect(houseGroup).not.toBeNull()
    expect(within(houseGroup).getByText('Boxes')).toBeTruthy()
    expect(houseGroup.querySelector('[data-schema-badge="houses"]')?.textContent).toBe('houses')
    fireEvent.click(within(container.querySelector('[data-schema="mesh"]') as HTMLElement).getByRole('button', { name: 'Hide Mesh layers' }))
    expect(useRenderStore.getState().schemaVisible.mesh).toBe(false)
    expect(useRenderStore.getState().schemaVisible.houses).toBe(true)
    expect(houseGroup.classList.contains('is-hidden')).toBe(false)
  })

  it('in Default mode, the Outliner lists scene node names and selects Cabins', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    act(() => {
      useRenderStore.getState().setMeshLayer('hf', 'mesh', 'Lake', {
        positions: [0, 0, 0, 1, 0, 0, 1, -1, 3],
        indices: [0, 1, 2],
        role: 'terrain',
      })
      useRenderStore.getState().setMeshLayer('rd', 'mesh', 'Pier', {
        positions: [0, 0, 0, 1, 0, 0, 1, -1, 3],
        indices: [0, 1, 2],
        role: 'road',
      })
      useRenderStore.getState().setMeshLayer('hx', 'mesh', 'Cabins', {
        positions: [0, 0, 0, 1, 0, 0, 1, -1, 3],
        indices: [0, 1, 2],
        role: 'houses',
      })
      useRenderStore.getState().setGuideLayer('gd', 'points', 'Markers', [{ x: 6, y: 24 }])
    })
    await openDrawer(container, 'Outliner')
    expect(container.querySelector('[data-testid="stage-outliner"]')).not.toBeNull()
    expect(container.querySelector('[data-path="/Lake"]')).not.toBeNull()
    expect(container.querySelector('[data-path="/Pier"]')).not.toBeNull()
    expect(container.querySelector('[data-path="/Cabins"]')).not.toBeNull()
    expect(container.querySelector('[data-path="/Markers"]')).not.toBeNull()
    fireEvent.click(container.querySelector('[data-path="/Cabins"]') as HTMLButtonElement)
    expect(useRenderStore.getState().selectedEditorNodeIds).toEqual(['hx'])
    fireEvent.click(container.querySelector('[data-path="/Markers"]') as HTMLButtonElement)
    expect(useRenderStore.getState().selectedEditorNodeIds).toEqual(['gd'])
  })

  it('in Default mode, the Control drawer lists collected control:true parameters', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClientWithControls()} />)
    await flushPreviewRefresh()
    const controlBtn = container.querySelector('.renderer-drawer-pill button[title="Control"]') as HTMLButtonElement
    expect(controlBtn).not.toBeNull()
    expect(controlBtn.querySelector('.renderer-drawer-pill__caption')).toBeNull()
    expect(controlBtn.textContent?.includes('Control')).toBe(false)
    await openDrawer(container, 'Control')
    expect(container.querySelector('[data-testid="valley-controls"]')).not.toBeNull()
    expect(within(container).getByLabelText('Seed')).toBeTruthy()
    expect(within(container).getByLabelText('Building height')).toBeTruthy()
  })

  it('does not expose point2d Control ports as numeric sliders', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient({
      nodes: [
        { id: 'n_pts', opId: 'control_points', params: { points: [[4, 23], [16, 21]] } },
        { id: 'n_plots', opId: 'points_along_polyline', params: { count: 6 } },
      ],
      functions: [
        {
          functionName: 'controlPoints',
          opId: 'control_points',
          inputs: [
            { name: 'points', type: 'point2d', mode: 'parameter', control: true, defaultValue: [[4, 23]], label: '控制点' },
          ],
          outputs: [],
        },
        {
          functionName: 'pointsAlongPolyline',
          opId: 'points_along_polyline',
          inputs: [
            { name: 'count', type: 'number', mode: 'parameter', control: true, defaultValue: 4, label: '地块数量' },
          ],
          outputs: [],
        },
      ],
    })} />)
    await flushPreviewRefresh()
    await openDrawer(container, 'Control')
    expect(within(container).getByLabelText('Plot count')).toBeTruthy()
    expect(container.querySelector('input[aria-label="控制点"]')).toBeNull()
  })

  it('hides the Control pill button when the scene exposes no control ports', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient({ nodes: [], functions: [] })} />)
    await flushPreviewRefresh()
    expect(container.querySelector('.renderer-drawer-pill button[title="Control"]')).toBeNull()
  })

  it('in Default mode, Output shows a Guide group independent of Road', async () => {
    useRenderStore.getState().setViewMode('default')
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setMeshLayer('rd', 'mesh', 'StrokeToMesh', {
      positions: [0, 0, 0.1, 1, 0, 0.1, 0, -1, 0.1],
      indices: [0, 1, 2],
      role: 'road',
    })
    useRenderStore.getState().setGuideLayer('gd', 'points', 'PointsToNode', [
      { x: 6, y: 24 }, { x: 18, y: 20 },
    ])
    await openDrawer(container, 'Output')
    const guideGroup = container.querySelector('[data-schema="guide"]') as HTMLElement
    expect(guideGroup).not.toBeNull()
    expect(within(guideGroup).getByText('Guide')).toBeTruthy()
    expect(guideGroup.querySelector('[data-schema-badge="guide"]')?.textContent).toBe('guide')
    fireEvent.click(within(container.querySelector('[data-schema="road"]') as HTMLElement).getByRole('button', { name: 'Hide Road layers' }))
    expect(useRenderStore.getState().schemaVisible.road).toBe(false)
    expect(useRenderStore.getState().schemaVisible.guide).toBe(true)
    expect(guideGroup.classList.contains('is-hidden')).toBe(false)
  })

  it('matches the Bundle tool capsule without legacy reset-view and fullscreen entries', () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    const shot = container.querySelector('.renderer-drawer-pill button[title="Save screenshot"]')
    expect(shot).not.toBeNull()
    expect(container.querySelector('.renderer-drawer-pill button[title="Reset view"]')).toBeNull()
    expect(container.querySelector('.renderer-drawer-pill button[title="Fullscreen"]')).toBeNull()
    expect(container.querySelectorAll('button[title="Save screenshot"]')).toHaveLength(1)
    expect(container.querySelector('.renderer-toolbar button[title="Save screenshot"]')).toBeNull()
  })

  it('captures the frame via the existing render API and presents a copyable PNG result (no clipboard/download)', async () => {
    const writeTextMock = vi.fn(async () => {})
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock, write: vi.fn(async () => {}) },
    })
    const createObjectURL = vi.fn(() => 'blob:should-not-be-used')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })

    const { container, getByLabelText } = render(<RendererSurface client={fakeClient()} />)
    const shot = container.querySelector('button[title="Save screenshot"]') as HTMLButtonElement

    await act(async () => { fireEvent.click(shot) })

    // The button drives the SAME render API the surface already had a handle to:
    // force a synchronous compose, then read the frame canvas.
    expect(renderFrameMock).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(container.querySelector('.renderer-shot-popover')).not.toBeNull())
    const popover = container.querySelector('.renderer-shot-popover') as HTMLElement
    expect(popover.getAttribute('role')).toBe('status')
    expect(popover.textContent).toContain('Screenshot ready')

    // Copyable readonly PNG data URL (base64) — selectable text, the same kind of
    // surface the export-URL popover uses since the iframe blocks the clipboard.
    const field = popover.querySelector('[aria-label="Screenshot PNG data URL"]') as HTMLTextAreaElement
    expect(field).not.toBeNull()
    expect(field.readOnly).toBe(true)
    expect(field.value).toBe(SHOT_DATA_URL)
    fireEvent.focus(field)
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(SHOT_DATA_URL.length)

    // Inline thumbnail the user can right-click → Copy/Save.
    const img = popover.querySelector('.renderer-shot-popover__preview') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toBe(SHOT_DATA_URL)

    // No blocked APIs: no clipboard write, no createObjectURL / <a download> click.
    expect(writeTextMock).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()

    // X close dismisses the popover.
    fireEvent.click(getByLabelText('Close screenshot result'))
    expect(container.querySelector('.renderer-shot-popover')).toBeNull()

    await act(async () => { fireEvent.click(shot) })
    await waitFor(() => expect(container.querySelector('.renderer-shot-popover')).not.toBeNull())
    fireEvent.pointerDown(document.body)
    expect(container.querySelector('.renderer-shot-popover')).toBeNull()
  })

  it('returns an actual composed PNG for a workbench transaction capture request', async () => {
    const originalParent = window.parent
    const postMessage = vi.fn()
    const parentWindow = { postMessage } as unknown as Window
    Object.defineProperty(window, 'parent', { configurable: true, value: parentWindow })
    try {
      render(<RendererSurface client={fakeClient()} />)
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: window.location.origin,
          source: parentWindow,
          data: { type: 'workbench:capture-preview', requestId: 'diff-1' },
        }))
      })
      await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workbench:preview-captured',
          requestId: 'diff-1',
          dataUrl: SHOT_DATA_URL,
          width: expect.any(Number),
          height: expect.any(Number),
        }),
        window.location.origin,
      ))
      expect(renderFrameMock).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'parent', { configurable: true, value: originalParent })
    }
  })

  it('closes an open drawer before presenting the Bundle screenshot result', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Effects')
    expect(container.querySelector('.renderer-drawer-panel.is-open')).not.toBeNull()

    await act(async () => {
      fireEvent.click(container.querySelector('button[title="Save screenshot"]') as HTMLButtonElement)
    })

    await waitFor(() => expect(container.querySelector('.renderer-shot-popover')).not.toBeNull())
    expect(container.querySelector('.renderer-drawer-panel.is-open')).toBeNull()
  })

  it('exports the current baked scene as scene.zip from the Output drawer', async () => {
    // scene.zip export chrome is for non-3DMesh modes; product default is Default.
    useRenderStore.getState().setViewMode('top')
    const writeTextMock = vi.fn(async () => {})
    const downloadUrl = 'http://192.168.50.20:9557/api/v1/scene-export/download/preview-export-2026-06-04T06-00-00Z'
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/scene-export/cook' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          bundleId: 'preview-export-2026-06-04T06-00-00Z',
          zipPath: '/tmp/project/exports/scene/preview-export/scene.zip',
          unpackedDir: '/tmp/project/exports/scene/preview-export/unpacked',
          downloadUrl,
          warnings: [],
        }), { status: 200 })
      }
      if (url === '/api/v1/baked/layers') {
        return new Response(JSON.stringify({ layers: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByLabelText } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Output')
    const exportButton = container.querySelector('button[aria-label="Export scene.zip"]') as HTMLButtonElement

    await act(async () => { fireEvent.click(exportButton) })

    await waitFor(() => expect(container.querySelector('.renderer-drawer-export-result')).not.toBeNull())
    expect(container.querySelector('button[aria-label="Export scene.zip"]')).toBe(exportButton)
    const popover = container.querySelector('.renderer-drawer-export-result') as HTMLElement
    expect(popover.getAttribute('role')).toBe('status')
    expect(popover.textContent).toContain('Scene export ready')
    const urlField = popover.querySelector('[aria-label="Scene zip download URL"]') as HTMLInputElement
    expect(urlField).not.toBeNull()
    expect(urlField.readOnly).toBe(true)
    expect(urlField.value).toBe(downloadUrl)
    fireEvent.focus(urlField)
    expect(urlField.selectionStart).toBe(0)
    expect(urlField.selectionEnd).toBe(downloadUrl.length)
    expect(container.querySelector('.renderer-export-download')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('Download scene.zip')
    expect(container.textContent).not.toContain('Open download page')
    expect(container.textContent).not.toContain('/tmp/project/exports/scene/preview-export/scene.zip')
    expect(writeTextMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scene-export/cook', expect.objectContaining({ method: 'POST' }))

    fireEvent.click(getByLabelText('Close scene export result'))
    expect(container.querySelector('.renderer-drawer-export-result')).toBeNull()

    await act(async () => { fireEvent.click(exportButton) })
    await waitFor(() => expect(container.querySelector('.renderer-drawer-export-result')).not.toBeNull())
    expect((getByLabelText('Scene zip download URL') as HTMLInputElement).value).toBe(downloadUrl)
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      url === '/api/v1/scene-export/cook' && (init as RequestInit | undefined)?.method === 'POST',
    )).toHaveLength(2)
  })

  it('uses the backend-provided scene.zip download URL without redundant fallback controls', async () => {
    useRenderStore.getState().setViewMode('top')
    const downloadUrl = 'http://10.11.12.13:9557/api/v1/scene-export/download/minimal-export'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/scene-export/cook' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          bundleId: 'minimal-export',
          zipPath: '/tmp/project/exports/scene/minimal-export/scene.zip',
          unpackedDir: '/tmp/project/exports/scene/minimal-export/unpacked',
          downloadUrl,
          warnings: [],
        }), { status: 200 })
      }
      if (url === '/api/v1/baked/layers') {
        return new Response(JSON.stringify({ layers: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Output')
    await act(async () => {
      fireEvent.click(container.querySelector('button[aria-label="Export scene.zip"]') as HTMLButtonElement)
    })

    await waitFor(() => expect(container.querySelector('.renderer-drawer-export-result')).not.toBeNull())
    const urlField = container.querySelector('[aria-label="Scene zip download URL"]') as HTMLInputElement
    expect(urlField).not.toBeNull()
    expect(urlField.readOnly).toBe(true)
    expect(urlField.value).toBe(downloadUrl)
    expect(container.querySelector('.renderer-export-download')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('Download scene.zip')
    expect(container.textContent).not.toContain('Open download page')
    expect(container.textContent).not.toContain('/tmp/project/exports/scene/minimal-export/scene.zip')
  })

  it('shows export errors in the Output drawer without touching graph state', async () => {
    useRenderStore.getState().setViewMode('top')
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/scene-export/cook') return new Response(JSON.stringify({ error: 'missing asset: grass' }), { status: 400 })
      if (url === '/api/v1/baked/layers') return new Response(JSON.stringify({ layers: [] }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByText } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Output')
    await act(async () => {
      fireEvent.click(container.querySelector('button[aria-label="Export scene.zip"]') as HTMLButtonElement)
    })

    await waitFor(() => expect(container.querySelector('.renderer-drawer-export-result.is-error')).not.toBeNull())
    const popover = container.querySelector('.renderer-drawer-export-result.is-error') as HTMLElement
    expect(popover.getAttribute('role')).toBe('status')
    expect(getByText(/Export failed/i)).toBeTruthy()
    expect(popover.textContent).toContain('missing asset: grass')
    expect(container.querySelector('.renderer-export-status--error')).toBeNull()
    expect(useRenderStore.getState().layers).toEqual({})
  })

  it('opens mutually exclusive Editable and Output drawers from the capsule', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Editable')
    const editableDrawer = container.querySelector('.renderer-drawer-panel.is-open') as HTMLElement
    expect(editableDrawer.querySelector('.renderer-layers__section--editable')).not.toBeNull()
    expect(within(editableDrawer).getAllByText('Editable')).toHaveLength(1)
    await openDrawer(container, 'Output')
    const outputDrawer = container.querySelector('.renderer-drawer-panel.is-open') as HTMLElement
    expect(outputDrawer.querySelector('.renderer-layers__section--output')).not.toBeNull()
    expect(outputDrawer.querySelector('.renderer-layers__section--editable')).toBeNull()
    expect(within(outputDrawer).getAllByText('Output')).toHaveLength(1)
  })

  it('provides a draggable grip to resize the shared drawer width', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Output')
    const panel = container.querySelector('.renderer-drawer-panel.is-open') as HTMLElement
    const grip = container.querySelector('.renderer-drawer-panel__resize') as HTMLElement
    expect(grip).not.toBeNull()
    expect(panel.style.getPropertyValue('--renderer-drawer-user-width')).toBe('220px')

    act(() => {
      fireEvent.mouseDown(grip, { clientX: 300 })
      fireEvent.mouseMove(window, { clientX: 340 })
      fireEvent.mouseUp(window)
    })

    expect(panel.style.getPropertyValue('--renderer-drawer-user-width')).toBe('260px')
    expect(localStorage.getItem('wb-scene-generator.preview-drawer-width')).toBe('260')
  })

  it('selects, scrolls, and starts renaming a newly added editable layer', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    const bakedLayers: Array<{
      nodePath: string
      nodeName: string
      value: number
      assetName: string
      cells: []
      attributes: Record<string, unknown>
    }> = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = fetchUrl(url)
      if (path.includes('/api/v1/baked/layers') && init?.method === 'POST') {
        bakedLayers.push({ nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: '', cells: [], attributes: {} })
        return new Response(JSON.stringify({ path: '/Layer' }), { status: 200 })
      }
      if (path.includes('/api/v1/baked/layers')) {
        return new Response(JSON.stringify({ layers: bakedLayers }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByLabelText, container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Editable')
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    await act(async () => { fireEvent.click(editable.querySelector('button[title="Add editable layer"]') as HTMLButtonElement) })

    await waitForRenameFocus(getByLabelText)
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Layer')
    expect(container.querySelector('.renderer-layer-row--baked.is-selected')?.textContent).toContain('0')
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('selects and starts renaming a newly added editable sub-layer', async () => {
    const bakedLayers = [
      { nodePath: '/Parent', nodeName: 'Parent', value: 1, assetName: '', cells: [], attributes: {} },
    ]
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = fetchUrl(url)
      if (path.includes('/api/v1/baked/sublayer') && init?.method === 'POST') {
        bakedLayers.push({ nodePath: '/Parent/Sub', nodeName: 'Sub', value: 2, assetName: '', cells: [], attributes: {} })
        return new Response(JSON.stringify({ path: '/Parent/Sub' }), { status: 200 })
      }
      if (path.includes('/api/v1/baked/layers')) {
        return new Response(JSON.stringify({ layers: bakedLayers }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getByLabelText, container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Editable')
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    await waitFor(() => expect(editable.querySelector('.renderer-layer-name')?.textContent).toBe('Parent'))
    await act(async () => { fireEvent.click(editable.querySelector('button[title="Add sub-layer"]') as HTMLButtonElement) })

    await waitForRenameFocus(getByLabelText)
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Parent/Sub')
  })

  it('opens inline rename mode when double-clicking an editable layer title', async () => {
    const layers = [
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: '', cells: [], attributes: {} },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ layers }), { status: 200 })))
    useRenderStore.getState().setBakedLayers([
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: '', cells: [], attributes: {} },
    ])

    const { getByLabelText, container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Editable')
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    fireEvent.doubleClick(editable.querySelector('.renderer-layer-name') as HTMLElement)

    await waitFor(() => expect(getByLabelText('Rename editable layer')).toBe(document.activeElement))
    expect((getByLabelText('Rename editable layer') as HTMLInputElement).value).toBe('Floor')
  })

  it('marks a clicked editable layer as selected and the active paint target', async () => {
    const layers = [
      { nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: '', cells: [], attributes: {} },
      { nodePath: '/Walls', nodeName: 'Walls', value: 2, assetName: '', cells: [], attributes: {} },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ layers }), { status: 200 })))
    useRenderStore.getState().setBakedLayers(layers)

    const { container } = render(<RendererSurface client={fakeClient()} />)
    await openDrawer(container, 'Editable')
    const editable = container.querySelector('.renderer-layers__section--editable') as HTMLElement
    const rows = editable.querySelectorAll('.renderer-layer-row--baked')
    fireEvent.click(rows[1])

    expect(rows[1].classList.contains('is-selected')).toBe(true)
    expect(rows[1].classList.contains('is-active')).toBe(true)
    expect(rows[1].getAttribute('aria-selected')).toBe('true')
    expect(rows[1].querySelector('.renderer-layer-paint-target')).toBeNull()
    expect(useRenderStore.getState().activeBakedLayerKey).toBe('baked:/Walls')
  })

  it('highlights the editor-selected node row (green) from store state', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    useRenderStore.getState().setSelectedEditorNodeIds(['sink'])
    await openDrawer(container, 'Output')
    const row = container.querySelector('.renderer-layers-drawer .renderer-layer-row')
    expect(row?.classList.contains('is-editor-selected')).toBe(true)
  })

  it('renders scene_output voxel layers as a scene-path hierarchy, not a flat list', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [
        { nodePath: '/Root', nodeName: 'Root', value: 1, cells: [{ x: 0, y: 0, z: 0 }] },
        { nodePath: '/Root/Child', nodeName: 'Child', value: 2, cells: [{ x: 1, y: 0, z: 0 }] },
        { nodePath: '/Root/Child/Leaf', nodeName: 'Leaf', value: 3, cells: [{ x: 2, y: 0, z: 0 }] },
      ],
      [
        { id: 1, name: 'root', type: 'scene' },
        { id: 2, name: 'child', type: 'scene' },
        { id: 3, name: 'leaf', type: 'scene' },
      ])
    await openDrawer(container, 'Output')
    const rows = Array.from(container.querySelectorAll('.renderer-layers-drawer .renderer-layer-row'))
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Root'),
      expect.stringContaining('Child'),
      expect.stringContaining('Leaf'),
    ]))
    expect(rows[1].classList.contains('renderer-layer-row--child')).toBe(true)
    expect(rows[2].classList.contains('renderer-layer-row--child')).toBe(true)
    expect((rows[2] as HTMLElement).style.paddingLeft).toBe('28px')
  })

  it('collapses descendants for output rows whose parent is also a layer', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [
        { nodePath: '/Root', nodeName: 'Root', value: 1, cells: [{ x: 0, y: 0, z: 0 }] },
        { nodePath: '/Root/Child', nodeName: 'Child', value: 2, cells: [{ x: 1, y: 0, z: 0 }] },
      ],
      [{ id: 1, name: 'root' }, { id: 2, name: 'child' }])
    await openDrawer(container, 'Output')
    const output = container.querySelector('.renderer-layers__section--output') as HTMLElement
    expect(output.querySelectorAll('.renderer-layer-row')).toHaveLength(2)
    act(() => (output.querySelector('button[title="Collapse"]') as HTMLButtonElement).click())
    expect(output.querySelectorAll('.renderer-layer-row')).toHaveLength(1)
  })

  it('mirrors a workbench:editor-selection postMessage into the highlight (host→pane wiring)', async () => {
    const { container } = render(<RendererSurface client={fakeClient()} />)
    await flushPreviewRefresh()
    useRenderStore.getState().setLayers('sink', 'scene_output',
      [{ nodePath: '/A', nodeName: 'Wall', value: 1, cells: [{ x: 0, y: 0, z: 0 }] }],
      [{ id: 1, name: 'wall', type: 'tile' }])
    await openDrawer(container, 'Output')
    expect(container.querySelector('.renderer-layer-row')?.classList.contains('is-editor-selected')).toBe(false)

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workbench:editor-selection', selectedNodeIds: ['sink'] },
      }))
    })

    await waitFor(() => {
      expect(useRenderStore.getState().selectedEditorNodeIds).toEqual(['sink'])
      expect(container.querySelector('.renderer-layer-row')?.classList.contains('is-editor-selected')).toBe(true)
    })
  })
})

describe('AssetStoreSurface', () => {
  it('renders the legacy titlebar chrome (zone dropdown + view dropdown + fullscreen) and a thumbnail grid', async () => {
    useAssetStoreStore.setState({
      zones: [],
      activeZone: 'raw',
      search: '',
      viewMode: 'grid',
      assets: [],
      total: 0,
      page: 1,
      pageSize: 60,
      loading: false,
      selected: null,
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/library/zones')) {
        return new Response(JSON.stringify(['raw', 'staging']), { status: 200 })
      }
      if (url.includes('/library/list')) {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'a1', alias: 'grass.png', zone: 'raw', blobSha256: 's', mimeType: 'image/png', sizeBytes: 1234, widthPx: 16, heightPx: 16, anchorX: null, anchorY: null },
            ],
            total: 1,
            page: 1,
            pageSize: 60,
          }),
          { status: 200 },
        )
      }
      return new Response('[]', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container, getByText } = render(<AssetStoreSurface client={fakeClient()} />)
    // Faithful legacy chrome: gradient wordmark, compact zone dropdown (raw→"Ra"),
    // icon-only view dropdown, and fullscreen — no titlebar search field or
    // plain Grid/List text buttons.
    expect(getByText('Asset Store')).toBeTruthy()
    expect(container.querySelector('.assetstore-zone-trigger')).not.toBeNull()
    expect(container.querySelector('.assetstore-view-trigger')).not.toBeNull()
    expect(container.querySelector('button[title="Settings"]')).toBeNull()
    expect(container.querySelector('.assetstore-ctrl-btn[title="Fullscreen"]')).not.toBeNull()

    await waitFor(() => {
      expect(container.querySelector('.asset-card')).not.toBeNull()
    })
    const img = container.querySelector('.asset-card-thumb img') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toContain('/api/v1/library/serve/')
  })

  it('highlights the asset bound to the selected editable layer', () => {
    localStorage.setItem('wb-scene-generator.preview.selectedLayers', JSON.stringify({
      layers: [{
        kind: 'baked',
        layerKey: 'baked:/Floor',
        nodePath: '/Floor',
        nodeName: 'Floor',
        value: 1,
        assetName: '草地',
        attributes: { asset_name: '草地' },
        voxelStats: { cellCount: 1, xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0, tokenCount: 0 },
      }],
      editContext: { editMode: false, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: false },
    }))
    useAssetStoreStore.setState({
      zones: [],
      activeZone: 'raw',
      search: '',
      viewMode: 'grid',
      assets: [
        { id: 'a1', alias: '[]_[]_[草地]_[]_[]_[风格]_[正常]_[抠图]_[16]_[静态]_[]_[0]_[].png', zone: 'raw', blobSha256: 's', mimeType: 'image/png', sizeBytes: 10, anchorX: null, anchorY: null },
      ],
      total: 1,
      page: 1,
      pageSize: 60,
      loading: false,
      selected: null,
    })

    const { container } = render(<AssetStoreSurface client={fakeClient()} />)
    expect(container.querySelector('.asset-card')?.classList.contains('is-layer-asset')).toBe(true)
  })

  it('renders rule metadata cards in the Rules zone and publishes the selection to the cross-pane bus', async () => {
    localStorage.removeItem('wb-scene-generator.assetstore.selectedRule')
    useAssetStoreStore.setState({
      zones: [], activeZone: RULES_ZONE, search: '', viewMode: 'grid',
      assets: [], total: 0, page: 1, pageSize: 60, loading: false, selected: null,
      rules: [], selectedRule: null,
    })
    const rule = {
      alias: 'common_16', name: 'common_16', description: 'desc', schemaVersion: 2, ppu: 16, spriteCount: 20,
      faces: { top: { basePieces: 16, mapEntries: 47, variants: 0, hasRandom: false } }, regions: [],
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/library/zones')) return new Response(JSON.stringify(['raw']), { status: 200 })
      if (url.includes('/library/rules')) return new Response(JSON.stringify([rule]), { status: 200 })
      return new Response('[]', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<AssetStoreSurface client={fakeClient()} />)
    await waitFor(() => expect(container.querySelector('.asset-rule-card')).not.toBeNull())
    const card = container.querySelector('.asset-rule-card') as HTMLElement
    expect(card.textContent).toContain('common_16')
    // No image thumbnail on a rule card — it's metadata only.
    expect(card.querySelector('img')).toBeNull()

    act(() => card.click())
    expect(useAssetStoreStore.getState().selectedRule?.alias).toBe('common_16')
    // Selection is published on the localStorage bus the left pane reads.
    expect(readSelectedRule()?.alias).toBe('common_16')
  })
})
