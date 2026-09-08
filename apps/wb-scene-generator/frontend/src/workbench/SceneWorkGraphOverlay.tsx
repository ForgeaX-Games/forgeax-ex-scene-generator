import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePipelineStore } from '@forgeax/node-runtime-react/editor'

import type { HttpApiClient, SceneAgentWorkGraph } from '../api/HttpApiClient.js'
import './SceneWorkGraphOverlay.css'

interface SceneWorkGraphOverlayProps {
  client: HttpApiClient
  projectId: string
  open: boolean
  onClose?: () => void
}

export function SceneWorkGraphOverlay({
  client,
  projectId,
  open,
  onClose,
}: SceneWorkGraphOverlayProps): JSX.Element | null {
  const [graph, setGraph] = useState<SceneAgentWorkGraph | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setGraph(await client.getSceneAgentWorkGraph(projectId))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [client, projectId])

  useEffect(() => {
    if (!open) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [open, refresh])

  const summary = useMemo(() => {
    const nodes = graph?.nodes ?? []
    return {
      total: nodes.length,
      active: nodes.filter((node) => ['pending', 'running', 'preview'].includes(node.status)).length,
      gated: nodes.filter((node) => node.humanGate?.required && !node.humanGate.approvedAt).length,
    }
  }, [graph])

  if (!open) return null
  return (
    <aside className="scene-work-graph" aria-label="Agent Work Graph">
      <header className="scene-work-graph__header">
        <div>
          <strong>Work Graph</strong>
          <span>Agent transactions and human gates</span>
        </div>
        <div className="scene-work-graph__actions">
          <button type="button" onClick={() => void refresh()}>Refresh</button>
          {onClose && <button type="button" aria-label="Close Work Graph" onClick={onClose}>×</button>}
        </div>
      </header>
      <div className="scene-work-graph__summary" aria-label="Work Graph summary">
        <span><strong>{summary.total}</strong> total</span>
        <span><strong>{summary.active}</strong> active</span>
        <span><strong>{summary.gated}</strong> gated</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {!error && graph?.nodes.length === 0 && <p>No active or recent agent work.</p>}
      <ol>
        {(graph?.nodes ?? []).map((node) => (
          <li key={node.id} data-status={node.status} data-work-node-kind={node.kind}>
            <button
              type="button"
              className="scene-work-graph__target"
              disabled={node.targetIds.length === 0}
              onClick={() => usePipelineStore.getState().requestSelectNodes(node.targetIds)}
            >
              <span>
                <small>{node.kind}</small>
                {node.targetIds[0] ?? 'Project scope'}
              </span>
              <strong data-status={node.status}>{node.status}</strong>
            </button>
            <dl>
              <dt>Target</dt><dd>{node.targetIds.join(', ') || '—'}</dd>
              <dt>Scope</dt><dd>{node.scope.join(', ') || 'read-only'}</dd>
              <dt>Artifacts</dt>
              <dd>{Object.keys(node.artifacts).join(' · ')}</dd>
              <dt>Diagnostics</dt><dd>{node.diagnostics.length}</dd>
              <dt>Checkpoint</dt><dd>{node.checkpoint?.id ?? '—'}</dd>
              {node.humanGate?.required && (
                <><dt>Human Gate</dt><dd>{node.humanGate.approvedAt ? 'approved' : node.humanGate.reasons.join(', ')}</dd></>
              )}
              {(node.budget.retries > 0 || node.budget.circuitOpen) && (
                <><dt>Retry</dt><dd>{node.budget.retries}/{node.budget.maxRetries}{node.budget.circuitOpen ? ' · circuit open' : ''}</dd></>
              )}
            </dl>
          </li>
        ))}
      </ol>
    </aside>
  )
}
