// Standalone split shell — the host chrome an authoring app lacks when it runs
// on its own dev server instead of inside Studio.
//
// A authoring plugin declares `surface: "split"` with a `left` (navigation /
// project menu) and a `center` (editor) pane; Studio embeds the plugin twice —
// once per pane — and lays them out. Reach the app any other way (dev server in a
// tab, or embedded by a launcher page) and only the center pane renders, so the
// whole left navigation is missing. This component
// reproduces Studio's layout locally: the left pane goes in a same-origin
// IFRAME (not inline), because left and center talk to each other through
// localStorage `storage` events, which only fire across documents.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './StandaloneExtensionShell.css'

export interface StandaloneExtensionShellProps {
  /** Same-origin URL of the `?pane=left` surface. */
  leftPaneUrl: string
  /** Center pane content (the authoring host). */
  children: ReactNode
  /** Lower bound for the left column, matching the plugin manifest's `panes.left.minWidth`. */
  minLeftWidth?: number
  /** Left column width before the user drags the splitter. */
  defaultLeftWidth?: number
  /** localStorage key the dragged width is persisted under. */
  storageKey?: string
}

/** True when no pane-aware host is laying us out.
 *
 * Keyed on the absence of an explicit `?pane=` parameter, NOT on being a top-level
 * document: a pane-aware host always names the pane it mounts (Studio's
 * `StandalonePluginIframe` appends `pane=left` / `pane=center` for every authoring
 * surface), while a plain embed — an `<iframe src="http://host:9565/">` in a
 * launcher page, or the dev server opened in a tab — carries no pane at all and
 * therefore still needs the left navigation drawn locally. */
export function isStandaloneExtension(): boolean {
  if (typeof window === 'undefined') return false
  return !new URLSearchParams(window.location.search).has('pane')
}

export function StandaloneExtensionShell({
  leftPaneUrl,
  children,
  minLeftWidth = 280,
  defaultLeftWidth = 360,
  storageKey = 'forgeax.standalone-shell.leftWidth',
}: StandaloneExtensionShellProps): JSX.Element {
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof localStorage === 'undefined') return defaultLeftWidth
    const raw = Number(localStorage.getItem(storageKey))
    return Number.isFinite(raw) && raw >= minLeftWidth ? raw : defaultLeftWidth
  })
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, String(leftWidth))
  }, [leftWidth, storageKey])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const left = rootRef.current?.getBoundingClientRect().left ?? 0
      // Leave room for the center pane so the editor can never be dragged away.
      const max = Math.max(minLeftWidth, window.innerWidth - 480)
      setLeftWidth(Math.min(max, Math.max(minLeftWidth, e.clientX - left)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, minLeftWidth])

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  return (
    <div
      ref={rootRef}
      className={`standalone-shell${dragging ? ' standalone-shell--dragging' : ''}`}
      style={{ gridTemplateColumns: `${leftWidth}px 4px 1fr` }}
    >
      <iframe className="standalone-shell__left" src={leftPaneUrl} title="Authoring navigation" />
      <div
        className="standalone-shell__splitter"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startDrag}
      />
      <div className="standalone-shell__center">{children}</div>
    </div>
  )
}
