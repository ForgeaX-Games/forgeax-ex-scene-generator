import { useCallback, useEffect, useState } from 'react'
import {
  isWorkbenchMessage,
  type WorkbenchFocus,
  type WorkbenchSource,
} from './protocol.js'

interface WorkbenchChild {
  /** Current workbench focus as last reported by the host (null = normal split). */
  focus: WorkbenchFocus
  /** True when THIS surface is the focused (fullscreen) pane. */
  isFocused: boolean
  /** Toggle fullscreen for this surface (host flips focus on/off). */
  requestFocus: () => void
  /** Push a status snapshot to the host status aggregation. */
  reportStatus: (payload: Record<string, unknown>) => void
}

// Child-side half of the `workbench:*` protocol. Used by the Renderer and
// AssetStore surfaces when running inside the host iframe; safely degrades to a
// no-op (focus stays null) when opened standalone (no parent window).
export function useWorkbenchChild(source: WorkbenchSource): WorkbenchChild {
  const [focus, setFocus] = useState<WorkbenchFocus>(null)

  const post = useCallback((msg: unknown) => {
    if (typeof window === 'undefined' || window.parent === window) return
    window.parent.postMessage(msg, '*')
  }, [])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isWorkbenchMessage(event.data)) return
      if (event.data.type === 'workbench:focus-changed') setFocus(event.data.focus)
    }
    window.addEventListener('message', handler)
    post({ type: 'workbench:query-focus' })
    return () => window.removeEventListener('message', handler)
  }, [post])

  const requestFocus = useCallback(() => {
    post({ type: 'workbench:request-focus', target: source })
  }, [post, source])

  const reportStatus = useCallback(
    (payload: Record<string, unknown>) => {
      post({ type: 'workbench:status-report', source, payload })
    },
    [post, source],
  )

  return { focus, isFocused: focus === source, requestFocus, reportStatus }
}
