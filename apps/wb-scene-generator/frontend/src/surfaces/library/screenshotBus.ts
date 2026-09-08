// Cross-pane channel for the left pane's "截图（去背景）" button. The left pane
// (?pane=left) has no access to the renderer's canvas, so it publishes a capture
// REQUEST and the renderer pane (?pane=renderer) answers with the RESULT — two
// facts crossing in opposite directions, one localStorage key each (sibling
// same-origin iframes → `storage` events, same pattern as editToolbarBus.ts).
//
// Payloads carry a request id so a stale answer (e.g. from a previous click that
// timed out) is ignored by the requester.

const LS_REQUEST = 'wb-scene-generator.preview.screenshotRequest'
const LS_RESULT = 'wb-scene-generator.preview.screenshotResult'

export interface ScreenshotRequest {
  id: string
  /** Crop the frame down to its non-transparent bounding box before encoding. */
  crop: boolean
}

export type ScreenshotResult =
  | {
      id: string
      status: 'success'
      dataUrl: string
      width: number
      height: number
      sourceWidth: number
      sourceHeight: number
      cropped: boolean
    }
  | { id: string; status: 'error'; message: string }

export function newScreenshotRequestId(): string {
  return `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const requestListeners = new Set<(req: ScreenshotRequest) => void>()
const resultListeners = new Set<(res: ScreenshotResult) => void>()

function read<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function subscribe<T>(key: string, listeners: Set<(value: T) => void>, cb: (value: T) => void): () => void {
  listeners.add(cb)
  if (typeof window === 'undefined') return () => { listeners.delete(cb) }
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== key) return
    const value = read<T>(key)
    if (value) cb(value)
  }
  window.addEventListener('storage', handler)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', handler)
  }
}

export function writeScreenshotRequest(request: ScreenshotRequest): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_REQUEST, JSON.stringify(request))
  }
  for (const cb of requestListeners) cb(request)
}

export function subscribeScreenshotRequest(cb: (req: ScreenshotRequest) => void): () => void {
  return subscribe(LS_REQUEST, requestListeners, cb)
}

export function writeScreenshotResult(result: ScreenshotResult): void {
  let delivered = result
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LS_RESULT, JSON.stringify(result))
    } catch {
      // A big scene's base64 PNG can exceed the origin's localStorage quota;
      // answer with an error rather than leaving the requester hanging.
      delivered = {
        id: result.id,
        status: 'error',
        message: 'Screenshot is too large to hand between panes — use the Preview toolbar camera button instead.',
      }
      try {
        localStorage.setItem(LS_RESULT, JSON.stringify(delivered))
      } catch { /* ignore */ }
    }
  }
  for (const cb of resultListeners) cb(delivered)
}

export function subscribeScreenshotResult(cb: (res: ScreenshotResult) => void): () => void {
  return subscribe(LS_RESULT, resultListeners, cb)
}
