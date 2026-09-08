// @vitest-environment jsdom
//
// P1-2: one project switch used to fire the alias-meta pool refetch from up
// to FOUR independent trigger sources (WS `project:viewing` + legacy
// `project:activated` on the `graph` channel, the host's
// `workbench:project-changed` postMessage, and the backend's post-`/view`
// `reloadGameTexturesBinding()` broadcast riding `library:changed` on the
// `asset` channel) — see wb-scene-generator-project-switch.md §2.5/§2.7.
// These tests assert the debounce+dedup collapses them into ONE
// `GET /api/v1/library/aliases-meta` + ONE `clearAllImgCache()`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useAliasMetas } from '../useAliasMetas'
import { HttpApiClient } from '../../../api/HttpApiClient'
import * as imageCache from '../../framework/asset/imageCache'

class FakeWebSocket {
  static last: FakeWebSocket | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  closed = false

  constructor(public url: string) {
    FakeWebSocket.last = this
  }

  send(): void {}
  close(): void {
    this.closed = true
  }
}

function emitGraph(kind: string, projectId: string): void {
  FakeWebSocket.last!.onmessage?.({
    data: JSON.stringify({ event: 'runtime', payload: { kind, projectId, pipelineId: 'main', newHash: 'h' } }),
  })
}

function emitLibraryChanged(): void {
  FakeWebSocket.last!.onmessage?.({ data: JSON.stringify({ event: 'library:changed', payload: {} }) })
}

let client: HttpApiClient
let fetchMock: ReturnType<typeof vi.fn>

describe('useAliasMetas', () => {
  beforeEach(() => {
    FakeWebSocket.last = null
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(imageCache, 'clearAllImgCache').mockImplementation(() => {})
    client = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
  })

  afterEach(() => {
    cleanup()
    client.dispose()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches once on mount', async () => {
    renderHook(() => useAliasMetas(client))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/library/aliases-meta', undefined)
    expect(imageCache.clearAllImgCache).toHaveBeenCalledTimes(1)
  })

  it('collapses one project switch (graph WS event(s) + host postMessage) into a single refetch', async () => {
    const { rerender } = renderHook(() => useAliasMetas(client))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()
    vi.mocked(imageCache.clearAllImgCache).mockClear()

    // A real switch fires ALL of these near-simultaneously for the SAME project.
    emitGraph('project:viewing', 'proj-2')
    emitGraph('project:activated', 'proj-2')
    window.postMessage({ type: 'workbench:project-changed', projectId: 'proj-2' }, '*')
    await new Promise((r) => setTimeout(r, 20)) // let the postMessage macrotask land
    rerender()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(imageCache.clearAllImgCache).toHaveBeenCalledTimes(1)

    // No extra fetch trickles in after the debounce window closes.
    await new Promise((r) => setTimeout(r, 350))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('folds a delayed library:changed (reloadGameTexturesBinding broadcast) into the same switch window', async () => {
    renderHook(() => useAliasMetas(client))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()
    vi.mocked(imageCache.clearAllImgCache).mockClear()

    emitGraph('project:viewing', 'proj-3')
    // Arrives ~100ms later, inside the debounce window opened by the switch above.
    await new Promise((r) => setTimeout(r, 100))
    emitLibraryChanged()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(imageCache.clearAllImgCache).toHaveBeenCalledTimes(1)
  })

  it('still refetches for a genuinely later, separate library:changed', async () => {
    renderHook(() => useAliasMetas(client))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()

    emitLibraryChanged()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()

    // A brand-new import well after the previous refetch settled — must NOT be swallowed.
    emitLibraryChanged()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('unsubscribes on unmount without leaking a pending debounce refetch', async () => {
    const { unmount } = renderHook(() => useAliasMetas(client))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fetchMock.mockClear()

    emitGraph('project:viewing', 'proj-4')
    unmount()

    await new Promise((r) => setTimeout(r, 350))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
