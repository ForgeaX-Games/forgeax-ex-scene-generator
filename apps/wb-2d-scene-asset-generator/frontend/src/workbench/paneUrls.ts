// Embedded sub-app URLs. The 2D asset generator serves every surface from the
// SAME Vite app and routes by `?pane=`. Same-origin keeps the `/api` proxy and
// WebSocket working for the child iframes without extra dev-server wiring.

// `left` is only used by the standalone shell (App.tsx) — inside Studio the host
// mounts that pane itself.
export type WorkbenchPane = 'preview' | 'assetstore' | 'left'

export function paneUrl(pane: WorkbenchPane): string {
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  return `${path}?pane=${pane}`
}
