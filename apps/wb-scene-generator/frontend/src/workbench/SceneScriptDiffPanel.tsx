import { useMemo } from 'react'

import type { SceneDiffEvidence, SemanticGraphDiff, TextDiffLine } from './sceneScriptDiff.js'

function visibleTextLines(lines: readonly TextDiffLine[]): TextDiffLine[] {
  const changed = new Set<number>()
  lines.forEach((line, index) => {
    if (line.kind !== 'unchanged') {
      changed.add(index)
      if (index > 0) changed.add(index - 1)
      if (index + 1 < lines.length) changed.add(index + 1)
    }
  })
  return [...changed].sort((a, b) => a - b).map((index) => lines[index])
}

function TextLines({ lines }: { lines: readonly TextDiffLine[] }): JSX.Element {
  const visible = useMemo(() => visibleTextLines(lines), [lines])
  if (visible.length === 0) return <p className="scene-diff__empty">No text changes.</p>
  return (
    <pre className="scene-diff__text-lines">
      {visible.map((line, index) => (
        <span key={`${line.kind}-${line.oldLine ?? ''}-${line.newLine ?? ''}-${index}`} data-kind={line.kind}>
          <b>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</b>
          <i>{line.oldLine ?? '·'}:{line.newLine ?? '·'}</i>
          {line.text || ' '}
        </span>
      ))}
    </pre>
  )
}

export function SceneScriptDiffPanel({
  open,
  draftRevision,
  draftText,
  draftGraph,
  evidence,
  onToggle,
}: {
  open: boolean
  draftRevision: string
  draftText: readonly TextDiffLine[]
  draftGraph: SemanticGraphDiff | null
  evidence: SceneDiffEvidence | null
  onToggle: () => void
}): JSX.Element {
  const draftChanged = draftText.some((line) => line.kind !== 'unchanged')
  return (
    <section className={`scene-diff${open ? ' is-open' : ''}`} aria-label="Scene Script transaction diff">
      <button
        type="button"
        className="scene-diff__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        Diff {draftChanged ? '• draft changed' : evidence ? `• ${evidence.preview.status}` : ''}
      </button>
      {open && (
        <div className="scene-diff__drawer">
          <header>
            <strong>Transaction evidence</strong>
            {evidence ? (
              <code title={evidence.transactionId}>
                {evidence.transactionId} · {evidence.beforeRevision.slice(0, 8)} → {evidence.afterRevision.slice(0, 8)}
              </code>
            ) : (
              <span>No accepted Save evidence yet</span>
            )}
          </header>

          {draftChanged && (
            <details>
              <summary>Current draft text · base {draftRevision.slice(0, 8)}</summary>
              <TextLines lines={draftText} />
              {draftGraph && (
                <p className="scene-diff__draft-graph">
                  Checked authoring entities: +{draftGraph.counts.entity.added}
                  {' '}−{draftGraph.counts.entity.removed}
                  {' '}~{draftGraph.counts.entity.modified}.
                  Runtime edge/group evidence is sampled only on Save.
                </p>
              )}
            </details>
          )}

          {evidence && (
            <div className="scene-diff__triptych">
              <article>
                <h3>Text</h3>
                <TextLines lines={evidence.text} />
              </article>
              <article>
                <h3>Authoring / Runtime graph</h3>
                <div className="scene-diff__counts">
                  {(['entity', 'edge', 'group'] as const).map((kind) => (
                    <span key={kind}>
                      {kind}: +{evidence.graph.counts[kind].added}
                      {' '}−{evidence.graph.counts[kind].removed}
                      {' '}~{evidence.graph.counts[kind].modified}
                    </span>
                  ))}
                </div>
                {evidence.graph.changes.length === 0 ? (
                  <p className="scene-diff__empty">No semantic graph changes.</p>
                ) : (
                  <ul className="scene-diff__graph-list">
                    {evidence.graph.changes.map((change) => (
                      <li key={`${change.kind}-${change.change}-${change.id}`}>
                        <b>{change.change === 'added' ? '+' : change.change === 'removed' ? '−' : '~'}</b>
                        <span>
                          {change.kind} · {change.label}
                          {change.statementId && <small>{change.statementId} · {change.source?.file}:{change.source?.line}</small>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article>
                <h3>Renderer preview · {evidence.preview.status}</h3>
                <div className="scene-diff__previews">
                  {(['before', 'after'] as const).map((side) => {
                    const capture = evidence.preview[side]
                    return (
                      <figure key={side}>
                        <img src={capture.dataUrl} alt={`${side} Renderer preview`} />
                        <figcaption>
                          {side} · {capture.width}×{capture.height}
                          <small>{capture.digest} · {capture.capturedAt}</small>
                        </figcaption>
                      </figure>
                    )
                  })}
                </div>
              </article>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
