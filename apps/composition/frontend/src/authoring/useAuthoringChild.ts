import { useCallback, useEffect, useState } from 'react'
import {
  isAuthoringMessage,
  authoringTargetOrigin,
  type AuthoringFocus,
  type AuthoringSource,
  type AuthoringMessage,
} from './protocol.js'

interface AuthoringChild {
  /** Current authoring focus as last reported by the host (null = normal overlay). */
  focus: AuthoringFocus
  /** True when THIS surface is the focused (fullscreen) pane. */
  isFocused: boolean
  /** Toggle fullscreen for this surface (host flips focus on/off). */
  requestFocus: () => void
  /** Push a status snapshot to the host status aggregation. */
  reportStatus: (payload: Record<string, unknown>) => void
}

// Child-side half of the `authoring:*` protocol. Used by the Renderer iframe;
// safely degrades to a no-op (focus stays null) when opened standalone (no
// parent window).
export function useAuthoringChild(source: AuthoringSource): AuthoringChild {
  const [focus, setFocus] = useState<AuthoringFocus>(null)

  const post = useCallback((msg: AuthoringMessage) => {
    if (typeof window === 'undefined' || window.parent === window) return
    window.parent.postMessage(msg, authoringTargetOrigin())
  }, [])

  useEffect(() => {
    const inIframe = typeof window !== 'undefined' && window.parent !== window
    const handler = (event: MessageEvent) => {
      if (inIframe) {
        if (event.origin !== authoringTargetOrigin()) return
        if (event.source !== window.parent) return
      }
      if (!isAuthoringMessage(event.data)) return
      if (event.data.type === 'authoring:focus-changed') setFocus(event.data.focus)
    }
    window.addEventListener('message', handler)
    post({ type: 'authoring:query-focus' })
    return () => window.removeEventListener('message', handler)
  }, [post])

  const requestFocus = useCallback(() => {
    post({ type: 'authoring:request-focus', target: source })
  }, [post, source])

  const reportStatus = useCallback(
    (payload: Record<string, unknown>) => {
      post({ type: 'authoring:status-report', source, payload })
    },
    [post, source],
  )

  return { focus, isFocused: focus === source, requestFocus, reportStatus }
}
