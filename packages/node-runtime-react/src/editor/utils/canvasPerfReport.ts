import type { Viewport } from '@xyflow/react'

let lastMoveSent = 0
const MOVE_THROTTLE_MS = 80

/** Opt-in only — set VITE_CANVAS_PERF_DEBUG=true when FORGEAX_CANVAS_PERF_DEBUG is on. */
export function isCanvasPerfReportEnabled(env?: Readonly<Record<string, string | undefined>>): boolean {
  const viteEnv = env ?? (typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: Readonly<Record<string, string | undefined>> }).env
    : undefined)
  return viteEnv?.VITE_CANVAS_PERF_DEBUG === 'true'
}

/** POST viewport phase markers so backend logs can tag overlapping HTTP/WS traffic. */
export function reportCanvasViewport(phase: 'start' | 'move' | 'end', viewport: Viewport): void {
  if (!isCanvasPerfReportEnabled()) return
  const now = performance.now()
  if (phase === 'move') {
    if (now - lastMoveSent < MOVE_THROTTLE_MS) return
    lastMoveSent = now
  }
  void fetch('/api/v1/debug/canvas/viewport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phase,
      zoom: viewport.zoom,
      x: viewport.x,
      y: viewport.y,
      t: now,
    }),
    keepalive: phase === 'end',
  }).catch(() => {})
}
