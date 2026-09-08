import { pluginFetch, pluginWsUrl } from '../../api/pluginHttp'

import { useEffect, useRef } from 'react'

// Accessors into the live viewer's reusable capture seam (see useThreeScene):
// `renderFrame` forces a synchronous paint so the buffer is fresh, and
// `getFrameCanvas` hands back the (preserveDrawingBuffer) renderer canvas.
// `captureContactSheet` renders an orthographic Front/Side/Top/Iso 2×2 sheet.
export interface ScreenshotCaptureAccessors {
  renderFrame: () => void
  getFrameCanvas: () => HTMLCanvasElement | null
  /** Compose a labeled orthographic 4-view contact sheet, or null if unavailable. */
  captureContactSheet: () => HTMLCanvasElement | null
}

// Listens on /ws for the backend's `screenshot:request` broadcast; renders a
// fresh frame, encodes the canvas to a PNG dataURL, and POSTs it back to
// /api/v1/agent/screenshot/store so the awaiting /capture request resolves.
export function useScreenshotCapture(accessors: ScreenshotCaptureAccessors): void {
  // Keep the latest accessors in a ref so the socket subscribes only once
  // (on mount) yet always calls the current renderFrame/getFrameCanvas.
  const accessorsRef = useRef(accessors)
  accessorsRef.current = accessors

  useEffect(() => {
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
    // Must go through pluginWsUrl (not a bare `location.origin + '/ws'`): under
    // Studio's `/__fx/<id>/` launcher embed the raw origin path 404s. See AGENTS.md
    // "Standalone HTTP wrapper".
    const url = pluginWsUrl('/ws')
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false

    const onMessage = (ev: MessageEvent) => {
      let msg: { event?: string; payload?: { captureId?: string } }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.event !== 'screenshot:request' || !msg.payload?.captureId) return
      const captureId = msg.payload.captureId
      // Report a renderer-side failure to /store so the awaiting /capture rejects
      // immediately instead of silently timing out (504) after the full window.
      const reportError = (reason: string): void => {
        void pluginFetch('/api/v1/agent/screenshot/store', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ captureId, error: reason }),
        })
      }
      const { renderFrame, getFrameCanvas, captureContactSheet } = accessorsRef.current
      // Prefer the orthographic 4-view contact sheet; fall back to a single live
      // frame if the sheet can't be composed (e.g. scene empty / pre-mount).
      renderFrame()
      const canvas = captureContactSheet() ?? getFrameCanvas()
      if (!canvas) {
        reportError('no canvas available (scene empty or viewer not mounted)')
        return
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reportError('canvas.toBlob returned null')
          return
        }
        const reader = new FileReader()
        reader.onerror = () => reportError('failed to encode screenshot blob')
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

    // Auto-reconnect: the renderer (headless daemon OR a human panel) must NOT
    // silently die on a transient WS drop (stack restart, network blip) — that
    // was the "renderer online but capture times out" symptom. Reconnect with
    // capped exponential backoff; reset on a clean open.
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
  }, [])
}
