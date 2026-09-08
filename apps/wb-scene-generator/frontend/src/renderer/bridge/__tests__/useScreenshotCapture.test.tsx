// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, cleanup } from '@testing-library/react'
import { useScreenshotCapture } from '../useScreenshotCapture'
import { useRenderStore } from '../../store'
import type { PluginHandle } from '../../framework/plugin'
import type { HttpApiClient } from '../../../api/HttpApiClient'

// Controllable fake WebSocket: capture the instance so the test can drive
// .onmessage(...) directly, no real socket involved.
class FakeWebSocket {
  static last: FakeWebSocket | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeWebSocket.last = this
  }
  close() {
    this.closed = true
  }
}

function Harness({ handle, projectId = 'p1' }: { handle: PluginHandle; projectId?: string }): JSX.Element {
  const ref = useRef<PluginHandle | null>(handle)
  const client = {
    ensureViewingProject: async () => projectId,
  } as unknown as HttpApiClient
  useScreenshotCapture(client, ref)
  return <div />
}

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

// Drive timer/RAF/microtask cycles so waitForContent's poll + renderAndSettle's
// rAF (~16ms in jsdom) + FileReader.readAsDataURL all complete before assertions.
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush(30)
}

describe('useScreenshotCapture', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    FakeWebSocket.last = null
    // Seed renderable content so the capture's content-gate resolves immediately
    // (the gate exists to skip snapshotting the empty pre-load canvas).
    useRenderStore.getState().setPreviewLayer('n1', 'out', 'Node 1', [[1, 1], [1, 1]])
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useRenderStore.getState().reset()
  })

  it('on screenshot:request, captures the canvas and POSTs it to /store', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const renderFrame = vi.fn()
    const canvas = {
      width: 4,
      height: 5,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'])),
    } as unknown as HTMLCanvasElement
    const handle: PluginHandle = {
      renderFrame,
      getFrameCanvas: () => canvas,
    }

    render(<Harness handle={handle} />)

    const ws = FakeWebSocket.last
    expect(ws).not.toBeNull()
    ws!.onmessage!({
      data: JSON.stringify({ event: 'screenshot:request', payload: { captureId: 'cap-123' } }),
    })

    // waitForContent poll + renderAndSettle rAF + FileReader are async; settle them.
    await settle()

    expect(renderFrame).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/agent/screenshot/store')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.captureId).toBe('cap-123')
    expect(body.width).toBe(4)
    expect(body.height).toBe(5)
    expect(typeof body.dataUrl).toBe('string')
  })

  it('ignores non-screenshot messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const handle: PluginHandle = { getFrameCanvas: () => null }
    render(<Harness handle={handle} />)
    FakeWebSocket.last!.onmessage!({ data: JSON.stringify({ event: 'runtime', payload: {} }) })
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores capture requests for another project', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const handle = {
      renderFrame: vi.fn(),
      getFrameCanvas: vi.fn(),
    } as unknown as PluginHandle
    render(<Harness handle={handle} projectId="lake-city" />)

    FakeWebSocket.last!.onmessage!({
      data: JSON.stringify({
        event: 'screenshot:request',
        payload: { captureId: 'cap-other', projectId: 'inland-city' },
      }),
    })
    await settle()

    expect(handle.renderFrame).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defers capture until the scene has content (no black pre-load frame)', async () => {
    // Start with an EMPTY store: this is the post-connect / pre-load window where
    // the canvas is still the bare #000 background — capturing now is the black-
    // screenshot bug. The gate must hold the capture until content arrives.
    useRenderStore.getState().reset()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const canvas = {
      width: 4,
      height: 5,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'])),
    } as unknown as HTMLCanvasElement
    const handle: PluginHandle = { renderFrame: vi.fn(), getFrameCanvas: () => canvas }

    render(<Harness handle={handle} />)
    FakeWebSocket.last!.onmessage!({
      data: JSON.stringify({ event: 'screenshot:request', payload: { captureId: 'cap-empty' } }),
    })

    // While the store is empty, the capture is gated — nothing posted yet.
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()

    // Content arrives (useNodePreviews finished its pull) → the gate releases and
    // the capture posts the now-populated frame.
    useRenderStore.getState().setPreviewLayer('n1', 'out', 'Node 1', [[1, 1], [1, 1]])
    await settle()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
