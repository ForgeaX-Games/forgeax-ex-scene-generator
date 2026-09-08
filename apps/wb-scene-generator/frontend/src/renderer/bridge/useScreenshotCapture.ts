import { useEffect, type RefObject } from 'react'
import type { PluginHandle } from '../framework/plugin'
import { useRenderStore } from '../store'
import { pluginFetch, pluginWsUrl } from '../../api/pluginHttp'
import type { HttpApiClient } from '../../api/HttpApiClient'

// Whether the render store currently holds ANY renderable scene content. Used to
// gate screenshot capture so we don't snapshot the empty `#000` canvas during the
// window after the (headless) renderer connects but before useNodePreviews has
// pulled the graph's layers in — the cause of intermittent all-black PNGs from
// the agent `scene:screenshot.capture` path.
function hasRenderableContent(): boolean {
  const s = useRenderStore.getState()
  return (
    Object.keys(s.layers).length > 0 ||
    Object.keys(s.previewLayers).length > 0 ||
    Object.keys(s.bakedLayers).length > 0 ||
    Object.keys(s.meshLayers).length > 0 ||
    Object.keys(s.scenePorts).length > 0 ||
    Object.keys(s.guideLayers).length > 0
  )
}

// Wait (up to maxWaitMs) until the store has renderable content, then resolve so
// the capture reflects the live scene rather than a pre-load empty frame. If the
// scene genuinely is empty, the timeout still resolves so capture never hangs —
// the contract stays "always produces a frame", just not a spuriously-black one.
function waitForContent(maxWaitMs = 4000, pollMs = 100): Promise<void> {
  return new Promise((resolve) => {
    if (hasRenderableContent()) { resolve(); return }
    const deadline = Date.now() + maxWaitMs
    const tick = () => {
      if (hasRenderableContent() || Date.now() >= deadline) { resolve(); return }
      setTimeout(tick, pollMs)
    }
    setTimeout(tick, pollMs)
  })
}

// Run the plugin's synchronous renderFrame() and wait one animation frame so the
// freshly composed pixels are committed to the backing canvas before we read it.
function renderAndSettle(handle: PluginHandle | null): Promise<void> {
  return new Promise((resolve) => {
    handle?.renderFrame?.()
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number
    raf(() => { handle?.renderFrame?.(); resolve() })
  })
}

// Listens on /ws for the backend's screenshot:request broadcast; captures the
// active plugin's canvas and POSTs it to /api/v1/agent/screenshot/store.
export function useScreenshotCapture(
  client: HttpApiClient,
  handleRef: RefObject<PluginHandle | null>,
): void {
  useEffect(() => {
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
    const url = pluginWsUrl('/ws')
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false

    const onMessage = (ev: MessageEvent) => {
      let msg: { event?: string; payload?: { captureId?: string; projectId?: string | null } }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.event !== 'screenshot:request' || !msg.payload?.captureId) return
      void (async () => {
        const requestedProjectId = msg.payload?.projectId
        if (requestedProjectId) {
          const viewingProjectId = await client.ensureViewingProject()
          if (viewingProjectId !== requestedProjectId) return
        }
        await captureAndStore(msg.payload!.captureId!, handleRef)
      })()
    }

    // Auto-reconnect: the renderer must not silently die on a transient WS drop
    // (stack restart, network blip) — that was the "renderer online but capture
    // times out" symptom. Reconnect with capped exponential backoff; reset on open.
    const connect = () => {
      if (closed) return
      ws = new WebSocket(url)
      ws.onopen = () => { attempts = 0 }
      ws.onmessage = onMessage
      const scheduleReconnect = () => {
        if (closed || retry) return
        const delay = Math.min(5000, 500 * 2 ** attempts)
        attempts += 1
        retry = setTimeout(() => { retry = null; connect() }, delay)
      }
      ws.onclose = scheduleReconnect
      ws.onerror = () => { try { ws?.close() } catch { /* noop */ } }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      try { ws?.close() } catch { /* noop */ }
    }
  }, [client, handleRef])
}

async function captureAndStore(
  captureId: string,
  handleRef: RefObject<PluginHandle | null>,
): Promise<void> {
  // Gate on scene content + settle a frame, so we never snapshot the empty
  // pre-load canvas (the intermittent black-screenshot bug).
  await waitForContent()
  const handle = handleRef.current
  await renderAndSettle(handle)
  const canvas = handle?.getFrameCanvas?.()
  if (!canvas) return
  canvas.toBlob((blob) => {
    if (!blob) return
    const reader = new FileReader()
    reader.onloadend = () => {
      void pluginFetch('/api/v1/agent/screenshot/store', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          captureId,
          dataUrl: reader.result,
          width: canvas.width,
          height: canvas.height,
        }),
      })
    }
    reader.readAsDataURL(blob)
  }, 'image/png')
}
