// Embedded sub-app URLs. The scene generator serves its Renderer child from the
// same Vite app and routes by `?pane=`. Same-origin keeps the `/api` proxy and
// WebSocket working without extra dev-server wiring.

// `left` is only used by the standalone shell (App.tsx) — inside Studio the host
// mounts that pane itself.
export type AuthoringPane = 'renderer' | 'left'

/** Build a same-origin child-pane URL, forwarding host context (game slug, etc.). */
export function paneUrl(pane: AuthoringPane): string {
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  const params = new URLSearchParams()
  params.set('pane', pane)
  if (typeof location !== 'undefined') {
    const src = new URLSearchParams(location.search)
    // Studio encodes the active ForgeaX game on every plugin iframe; the
    // renderer needs the same slug for game-scoped actions such as mesh3d export.
    for (const key of ['slug', 'projectId', 'locale'] as const) {
      const value = src.get(key)
      if (value) params.set(key, value)
    }
  }
  return `${path}?${params.toString()}`
}
