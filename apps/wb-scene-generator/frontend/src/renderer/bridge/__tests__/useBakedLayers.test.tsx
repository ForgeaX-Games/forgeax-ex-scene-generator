// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'
import { useBakedLayers, refreshBakedLayers } from '../useBakedLayers'
import { bakedApi } from '../bakedApi'
import type { BakedLayerDTO } from '../bakedApi'
import { hasLocalBakedLayerEdits, useRenderStore } from '../../store'
import { writeEditMode } from '../../../surfaces/library/editToolbarBus'
import { HttpApiClient } from '../../../api/HttpApiClient'

let mockEditMode = false
vi.mock('../../../surfaces/library/editToolbarBus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../surfaces/library/editToolbarBus')>()
  return {
    readEditMode: () => mockEditMode,
    subscribeEditMode: actual.subscribeEditMode,
    writeEditMode: actual.writeEditMode,
  }
})

vi.mock('../bakedApi', () => {
  const list = vi.fn()
  return {
    bakedApi: {
      list,
      // Production refreshes consume the listResult envelope so truncation
      // metadata is preserved. Keep the test's concise layer fixtures while
      // faithfully exposing that protocol.
      listResult: vi.fn(async (mode?: 'summary' | 'full') => ({ layers: await list(mode) })),
    },
  }
})

class FakeWebSocket {
  static last: FakeWebSocket | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  closed = false

  constructor(public url: string) {
    FakeWebSocket.last = this
  }

  close(): void {
    this.closed = true
  }
}

// `useBakedLayers` now shares the SAME `/ws` connection `useNodePreviews`/
// `useAliasMetas` use (via `client.subscribe`/`subscribeRaw`) instead of
// opening its own socket — so tests drive it through a real `HttpApiClient`
// wired to `FakeWebSocket`, exactly like `api/__tests__/httpApiClient.test.ts`.
let client: HttpApiClient

describe('useBakedLayers', () => {
  beforeEach(() => {
    mockEditMode = false
    useRenderStore.getState().reset()
    FakeWebSocket.last = null
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    vi.mocked(bakedApi.list).mockReset()
    client = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
  })

  afterEach(() => {
    cleanup()
    client.dispose()
    vi.unstubAllGlobals()
  })

  it('loads full baked cells when edit mode turns on in the same iframe', async () => {
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', cellCount: 5 },
      ])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          cells: [{ x: 1, y: 2, z: 0, token: 'grass' }],
        },
      ])

    renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(1))
    expect(bakedApi.list).toHaveBeenLastCalledWith('summary')
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([])

    writeEditMode(true)

    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(2))
    expect(bakedApi.list).toHaveBeenLastCalledWith('full')
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 1, y: 2, z: 0, token: 'grass' },
    ])
  })

  it('refreshes baked layers when the backend broadcasts baked:changed', async () => {
    mockEditMode = true
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          cells: [{ x: 2, y: 3, z: 0, token: 'grass' }],
        },
      ])

    renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(1))

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({ event: 'baked:changed', payload: {} }),
    })

    await waitFor(() => {
      expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
        { x: 2, y: 3, z: 0, token: 'grass' },
      ])
    })
  })

  it('defers baked:changed refresh while local paint is dirty', async () => {
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [],
        },
      ])

    renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())

    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 1, y: 2, z: 0, token: 'grass' },
    ])

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({ event: 'baked:changed', payload: {} }),
    })

    await Promise.resolve()
    expect(bakedApi.list).toHaveBeenCalledTimes(1)
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 1, y: 2, z: 0, token: 'grass' },
    ])
  })

  it('keeps baked layers visible during project switch until the new fetch lands', async () => {
    mockEditMode = true
    let resolveProjectList: (layers: BakedLayerDTO[]) => void = () => {}
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [{ x: 0, y: 0, z: 0, token: 'grass' }],
        },
      ])
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveProjectList = resolve
      }))

    renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())
    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 9, y: 9, z: 0, token: 'grass' },
    ])

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workbench:project-changed', projectId: 'project-2' },
      }))
    })

    // Stale-while-revalidate: no blank flash while the next project loads.
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 9, y: 9, z: 0, token: 'grass' },
    ])
    expect(bakedApi.list).toHaveBeenCalledTimes(2)

    resolveProjectList([])
    await waitFor(() => expect(useRenderStore.getState().bakedLayers).toEqual({}))
  })

  it('still refreshes baked layers for the viewing project while another project executes', async () => {
    mockEditMode = true
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          cells: [{ x: 4, y: 5, z: 0, token: 'grass' }],
        },
      ])

    renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workbench:project-changed', projectId: 'project-viewing' },
      }))
    })
    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(2))

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({
        event: 'runtime',
        payload: { kind: 'project:executing', projectId: 'project-other' },
      }),
    })

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({
        event: 'baked:changed',
        payload: { projectId: 'project-viewing' },
      }),
    })

    await waitFor(() => {
      expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
        { x: 4, y: 5, z: 0, token: 'grass' },
      ])
    })
  })

  it('reloads baked layers on project:viewing without preserving same-path dirty cells', async () => {
    mockEditMode = true
    vi.mocked(bakedApi.list)
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'grass',
          assetType: 'tile',
          version: 1,
          cells: [{ x: 0, y: 0, z: 0, token: 'grass' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          nodePath: '/Layer',
          nodeName: 'Layer',
          value: 1,
          assetName: 'stone',
          assetType: 'tile',
          version: 1,
          cells: [{ x: 2, y: 3, z: 0, token: 'stone' }],
        },
      ])

    renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())
    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 9, y: 9, z: 0, token: 'grass' },
    ])

    FakeWebSocket.last!.onmessage?.({
      data: JSON.stringify({
        event: 'runtime',
        payload: { kind: 'project:viewing', projectId: 'project-2' },
      }),
    })

    await waitFor(() => {
      expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
        { x: 2, y: 3, z: 0, token: 'stone' },
      ])
    })
  })

  it('unsubscribes from the shared client socket on unmount (no longer owns/closes it)', async () => {
    // The hook now shares `client`'s ONE `/ws` connection (see useBakedLayers.ts)
    // instead of opening/closing its own — so unmount must drop its listeners
    // WITHOUT closing the socket (other hooks on the same client may still need
    // it). Prove listener-removal behaviorally: after unmount, a `baked:changed`
    // broadcast no longer triggers a refetch.
    vi.mocked(bakedApi.list).mockResolvedValue([])

    const { unmount } = renderHook(() => useBakedLayers(client))
    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull())
    const ws = FakeWebSocket.last!
    await waitFor(() => expect(bakedApi.list).toHaveBeenCalledTimes(1))

    unmount()
    expect(ws.closed).toBe(false)

    ws.onmessage?.({ data: JSON.stringify({ event: 'baked:changed', payload: {} }) })
    await new Promise((r) => setTimeout(r, 420)) // > useBakedLayers' BAKED_CHANGED_DEBOUNCE_MS (400)
    expect(bakedApi.list).toHaveBeenCalledTimes(1)
  })

  // Regression: a STRUCTURAL baked mutation (add/move/remove/bake) right after a
  // paint left the just-created layer / new order invisible until a manual
  // reload. Cause: the structural refresh used the DEFAULT refreshBakedLayers(),
  // which defers while a paint edit is still dirty, so the new structure never
  // landed. Structural ops now drain paint persists then force the refresh in
  // (deferIfLocalPending:false). These two cases pin both halves of that fix.
  describe('structural refresh must not be swallowed by an in-flight paint', () => {
    it('a DEFAULT refresh is deferred while paint is dirty — the old "must reload" bug', async () => {
      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [] },
      ])
      renderHook(() => useBakedLayers(client))
      await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())

      // A paint is in flight (dirty) — exactly the place-object → auto-sub-layer case.
      useRenderStore.getState().paintBakedCells('baked:/Layer', [{ x: 0, y: 0, z: 0, token: 'grass' }])

      // Backend has since created a NEW sub-layer; a DEFAULT refresh tries to pull it.
      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [{ x: 0, y: 0, z: 0, token: 'grass' }] },
        { nodePath: '/Layer/layer-1', nodeName: 'layer-1', value: 2, assetName: 'stone', assetType: 'tile', version: 2, cells: [] },
      ])
      await refreshBakedLayers() // default deferIfLocalPending: true

      // Deferred → the new layer is NOT visible (this is the reported bug).
      expect(useRenderStore.getState().bakedLayers['baked:/Layer/layer-1']).toBeUndefined()
    })

    it('a FORCED refresh (what structural ops now use) lands the new structure despite dirty paint', async () => {
      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [] },
      ])
      renderHook(() => useBakedLayers(client))
      await waitFor(() => expect(useRenderStore.getState().bakedLayers['baked:/Layer']).toBeDefined())

      useRenderStore.getState().paintBakedCells('baked:/Layer', [{ x: 0, y: 0, z: 0, token: 'grass' }])
      expect(hasLocalBakedLayerEdits()).toBe(true)

      vi.mocked(bakedApi.list).mockResolvedValueOnce([
        { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'grass', assetType: 'tile', version: 1, cells: [{ x: 0, y: 0, z: 0, token: 'grass' }] },
        { nodePath: '/Layer/layer-1', nodeName: 'layer-1', value: 2, assetName: 'stone', assetType: 'tile', version: 2, cells: [] },
      ])
      // structuralBakedRefresh drains paint persists then forces this in.
      await refreshBakedLayers({ deferIfLocalPending: false })

      // The new sub-layer is now visible immediately — no manual reload needed.
      expect(useRenderStore.getState().bakedLayers['baked:/Layer/layer-1']).toBeDefined()
      expect(useRenderStore.getState().bakedLayers['baked:/Layer/layer-1'].nodeName).toBe('layer-1')
    })
  })
})
