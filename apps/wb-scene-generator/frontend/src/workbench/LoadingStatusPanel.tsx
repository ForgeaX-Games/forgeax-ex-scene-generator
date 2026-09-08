import { useEffect, useRef, useState } from 'react'
import { sceneT } from '../sceneI18n.js'
import './LoadingStatusPanel.css'

export type LoadingStepState = 'active' | 'done'

export interface LoadingStep {
  id: string
  label: string
  state: LoadingStepState
  /** Optional "42/78"-style counter shown after the label. */
  detail?: string
}

const LINGER_MS = 1100

/**
 * Compact, non-blocking progress panel anchored inside the renderer pane.
 * Shows what a project switch is currently waiting on — persisting the
 * outgoing project, re-viewing the new one, loading its node graph, plus the
 * renderer iframe's own boot + data fetches (node previews / baked layers /
 * alias metadata) — instead of leaving the user staring at a blank/stale
 * preview with no idea what is happening or which step is stuck.
 *
 * Collapsed by default to a single-line pill naming the current step; click
 * to expand the full checklist. Auto-hides ~1.1s after the last step
 * finishes so it never becomes permanent chrome.
 */
export function LoadingStatusPanel({ steps }: { steps: LoadingStep[] }): JSX.Element | null {
  const hasActive = steps.some((s) => s.state === 'active')
  const [visible, setVisible] = useState(hasActive)
  const [collapsed, setCollapsed] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (hasActive) {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current)
        hideTimer.current = null
      }
      setVisible(true)
      setCollapsed(true)
    } else {
      hideTimer.current = setTimeout(() => setVisible(false), LINGER_MS)
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [hasActive])

  if (!visible || steps.length === 0) return null

  const activeStep = steps.find((s) => s.state === 'active')
  const doneCount = steps.filter((s) => s.state === 'done').length

  return (
    <div className={`load-status${hasActive ? '' : ' load-status--done'}`} role="status" aria-live="polite">
      <button
        type="button"
        className="load-status__summary"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={`load-status__spinner${hasActive ? '' : ' load-status__spinner--done'}`} aria-hidden="true" />
        <span className="load-status__text">{hasActive ? activeStep?.label ?? sceneT('loading.active') : sceneT('loading.done')}</span>
        <span className="load-status__count">
          {doneCount}/{steps.length}
        </span>
        <span className={`load-status__chevron${collapsed ? '' : ' load-status__chevron--open'}`} aria-hidden="true" />
      </button>
      {!collapsed && (
        <ul className="load-status__list">
          {steps.map((s) => (
            <li key={s.id} className={`load-status__item load-status__item--${s.state}`}>
              <span className="load-status__icon" aria-hidden="true" />
              <span className="load-status__label">{s.label}</span>
              {s.detail && <span className="load-status__detail">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
