// 💡 Swappable 2D canvas backend
//
// Pure paint modules (buildSurface / buildIsoSurface / buildVoxelMaster / compose)
// allocate their working surfaces through this indirection instead of touching
// `OffscreenCanvas` / `document.createElement('canvas')` / `window.devicePixelRatio`
// directly. The default backend is the browser (OffscreenCanvas) so existing
// in-browser rendering behavior is byte-for-byte unchanged.
//
// A node-only entry (renderer/server) swaps in a `@napi-rs/canvas` backend via
// `setCanvas2DBackend` to render the same paint code server-side with NO browser.
// This module intentionally has NO import of any browser-only or node-only canvas
// package — it stays safe to bundle for the browser.

/** Minimal canvas surface the pure paint code needs (matches OffscreenCanvas / @napi-rs canvas). */
export interface Surface2D {
  width: number
  height: number
  getContext(t: '2d'): CanvasRenderingContext2D | null
}

interface Backend {
  createSurface(w: number, h: number): Surface2D
  devicePixelRatio(): number
}

// Default (browser) backend. Mirrors the per-mode `createCanvas` helper that the
// pure paint modules used before this indirection: prefer OffscreenCanvas, fall
// back to a DOM <canvas> when it's absent (e.g. jsdom test env). Keeping this
// exact fallback preserves byte-for-byte in-browser + jsdom-test behavior.
let backend: Backend = {
  createSurface: (w, h) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as Surface2D
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return c as unknown as Surface2D
  },
  devicePixelRatio: () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
}

export function setCanvas2DBackend(b: Backend): void {
  backend = b
}

export function createSurface(w: number, h: number): Surface2D {
  return backend.createSurface(w, h)
}

export function devicePixelRatio(): number {
  return backend.devicePixelRatio()
}
