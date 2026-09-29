import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePipelineStore } from '@forgeax/node-runtime-react/editor'

import type { SceneScriptDiagnostic } from '../api/HttpApiClient.js'
import { sceneT } from '../sceneI18n.js'
import {
  focusSceneScriptDiagnostic,
  useAllSceneScriptDiagnostics,
} from './sceneScriptDiagnosticBridge.js'
import './SceneScriptDiagnosticDock.css'

function cssAttrEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')
}

function markCanvasNodes(diagnostics: readonly SceneScriptDiagnostic[]): void {
  const root = document.querySelector('.scene-authoring__node-editor')
  if (!root) return
  root.querySelectorAll('[data-scene-diagnostic]').forEach((el) => {
    el.removeAttribute('data-scene-diagnostic')
  })
  for (const diagnostic of diagnostics) {
    const ids = [
      diagnostic.graph?.authoringNodeId,
      diagnostic.statementId,
      ...(diagnostic.graph?.runtimeNodeIds ?? []),
    ].filter((id): id is string => Boolean(id))
    for (const id of ids) {
      const el = root.querySelector(`.react-flow__node[data-id="${cssAttrEscape(id)}"]`)
      if (!el) continue
      const prev = el.getAttribute('data-scene-diagnostic')
      if (diagnostic.severity === 'error' || prev !== 'error') {
        el.setAttribute('data-scene-diagnostic', diagnostic.severity)
      }
    }
  }
}

function selectionHasText(): boolean {
  const text = window.getSelection()?.toString().trim()
  return Boolean(text)
}

function rightInsetFor(editor: Element): number | undefined {
  const editorRect = editor.getBoundingClientRect()
  const studio = editor.parentElement?.querySelector('.scene-script-studio')
  if (studio instanceof HTMLElement && studio.offsetWidth > 0) {
    return Math.max(8, Math.round(editorRect.right - studio.getBoundingClientRect().left + 8))
  }
  const blockers = [...editor.querySelectorAll('.react-flow__minimap, .zoom-slider-panel')]
  if (blockers.length === 0) return undefined
  const left = Math.min(...blockers.map((el) => el.getBoundingClientRect().left))
  return Math.max(12, Math.round(editorRect.right - left + 8))
}

export function SceneScriptDiagnosticDock({ projectId }: { projectId: string }): JSX.Element | null {
  const diagnostics = useAllSceneScriptDiagnostics(projectId)
  const dockRef = useRef<HTMLElement>(null)
  const [rightPx, setRightPx] = useState<number | undefined>()

  useEffect(() => {
    markCanvasNodes(diagnostics)
    return () => markCanvasNodes([])
  }, [diagnostics])

  useLayoutEffect(() => {
    const dock = dockRef.current
    const editor = dock?.closest('.scene-authoring__node-editor')
    if (!dock || !editor) return
    const layout = editor.parentElement

    const Observe = typeof ResizeObserver === 'function'
      ? ResizeObserver
      : class {
        observe(): void {}
        disconnect(): void {}
      }
    const ro = new Observe(() => setRightPx(rightInsetFor(editor)))
    const sync = () => {
      setRightPx(rightInsetFor(editor))
      const studio = layout?.querySelector('.scene-script-studio')
      if (studio) ro.observe(studio)
      for (const el of editor.querySelectorAll('.react-flow__minimap, .zoom-slider-panel')) {
        ro.observe(el)
      }
    }
    sync()
    ro.observe(editor)
    if (layout) ro.observe(layout)
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(sync) : { disconnect() {} }
    if (mo instanceof MutationObserver) {
      mo.observe(editor, { childList: true, subtree: true })
      if (layout) mo.observe(layout, { childList: true })
    }
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [diagnostics])

  if (diagnostics.length === 0) return null

  const errors = diagnostics.filter((item) => item.severity === 'error').length
  const warnings = diagnostics.length - errors

  const focus = (diagnostic: SceneScriptDiagnostic) => {
    const nodeId = diagnostic.graph?.authoringNodeId
      ?? diagnostic.statementId
      ?? diagnostic.graph?.runtimeNodeIds?.[0]
    if (nodeId) usePipelineStore.getState().requestSelectNodes([nodeId])
    focusSceneScriptDiagnostic(diagnostic)
  }

  return (
    <aside
      ref={dockRef}
      className="scene-diagnostic-dock"
      data-tone={errors > 0 ? 'error' : 'warning'}
      style={rightPx !== undefined ? { right: rightPx } : undefined}
      aria-label={sceneT('diagnostics.dock')}
    >
      <header className="scene-diagnostic-dock__title">
        <strong>{sceneT('diagnostics.dock')}</strong>
        <div className="scene-diagnostic-dock__counts">
          {errors > 0 ? (
            <span data-severity="error">{sceneT('diagnostics.errors', { count: errors })}</span>
          ) : null}
          {warnings > 0 ? (
            <span data-severity="warning">{sceneT('diagnostics.warnings', { count: warnings })}</span>
          ) : null}
        </div>
      </header>
      <ul>
        {diagnostics.map((diagnostic, index) => {
          const nodeId = diagnostic.graph?.authoringNodeId
            ?? diagnostic.statementId
            ?? diagnostic.graph?.runtimeNodeIds?.[0]
          return (
            <li key={`${diagnostic.code}-${nodeId ?? index}`} data-severity={diagnostic.severity}>
              <div
                className="scene-diagnostic-dock__item"
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (selectionHasText()) return
                  focus(diagnostic)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    focus(diagnostic)
                  }
                }}
              >
                <span className="scene-diagnostic-dock__meta">
                  <span className="scene-diagnostic-dock__severity">
                    {diagnostic.severity === 'error'
                      ? sceneT('diagnostics.severityError')
                      : sceneT('diagnostics.severityWarning')}
                  </span>
                  <code>{diagnostic.code}</code>
                </span>
                <span className="scene-diagnostic-dock__message">{diagnostic.message}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
