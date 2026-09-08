// Embedded sub-app URLs. Every surface is served from the SAME Vite app and
// routed by `?pane=` (ported from the scene generator). Same-origin keeps the
// `/api` proxy and WebSocket working for child iframes without extra dev-server
// wiring.

// `left` is only used by the standalone shell (App.tsx) — inside Studio the host
// mounts that pane itself.
export type WorkbenchPane = 'viewer3d' | 'left'

export function paneUrl(pane: WorkbenchPane): string {
  const path = typeof location !== 'undefined' ? location.pathname : '/'
  return `${path}?pane=${pane}`
}
