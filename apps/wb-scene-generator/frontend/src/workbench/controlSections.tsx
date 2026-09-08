// Shared collapsible section chrome for left-pane control stacks (Scene Generator,
// Asset Store). Styled by `.scene-left-pane .editor-controls__*` in WorkbenchLeftPane.css.

import { useRef } from 'react'

export function CollapseTriangle({
  collapsed,
  onClick,
}: {
  collapsed: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`section-collapse-toggle${collapsed ? ' is-collapsed' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d={collapsed ? 'M3 1L7 5L3 9' : 'M1 3L5 7L9 3'}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/** Top section title: collapse only (no height drag). */
export function SectionTitle({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="editor-controls__title">
      {label}
      <CollapseTriangle collapsed={collapsed} onClick={onToggle} />
    </div>
  )
}

/** Lower section title: drag to resize the section directly above. */
export function DragTitle({
  label,
  collapsed,
  onToggle,
  onDrag,
  onDragStart,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  onDrag: (dy: number) => void
  onDragStart?: () => void
}): JSX.Element {
  const lastYRef = useRef<number | null>(null)

  return (
    <div
      className="editor-controls__title is-draggable"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('.section-collapse-toggle')) return
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        lastYRef.current = e.clientY
        onDragStart?.()
      }}
      onPointerMove={(e) => {
        if (lastYRef.current === null) return
        const dy = e.clientY - lastYRef.current
        lastYRef.current = e.clientY
        onDrag(dy)
      }}
      onPointerUp={() => {
        lastYRef.current = null
      }}
      onPointerCancel={() => {
        lastYRef.current = null
      }}
    >
      {label}
      <CollapseTriangle collapsed={collapsed} onClick={onToggle} />
    </div>
  )
}
