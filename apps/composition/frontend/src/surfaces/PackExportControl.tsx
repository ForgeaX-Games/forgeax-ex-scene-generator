/**
 * The "pack" control on the preview's left-hand pill: cook the open project
 * into an engine `*.pack.ts` under the active game's assets.
 *
 * Button and result popover live in two different containers of
 * `RendererSurface`, so this exports a hook plus two renderers rather than one
 * component. It stays out of `RendererSurface.tsx` because that file is at its
 * line budget.
 */
import { useState } from 'react'
import { enginePackApi, type PackExportResult } from '../renderer/bridge/enginePackApi.js'
import { sceneT } from '../sceneI18n.js'
import { PackingBox } from './icons.js'

type PackExportState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; result: PackExportResult }
  | { status: 'error'; message: string }

/** Shared by both dock popovers — a read-only textarea the user copies out of. */
export function selectAllText(e: React.SyntheticEvent<HTMLTextAreaElement>): void {
  e.currentTarget.select()
}

export interface PackExportControl {
  state: PackExportState
  run: (gameSlug: string | null | undefined) => void
  dismiss: () => void
}

export function usePackExport(): PackExportControl {
  const [state, setState] = useState<PackExportState>({ status: 'idle' })
  const run = (gameSlug: string | null | undefined): void => {
    if (state.status === 'pending') return
    setState({ status: 'pending' })
    void enginePackApi
      .cook({ gameSlug: gameSlug?.trim() || undefined })
      .then((result) => setState({ status: 'success', result }))
      .catch((error: unknown) =>
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
      )
  }
  return { state, run, dismiss: () => setState({ status: 'idle' }) }
}

export function PackExportButton({
  control,
  gameSlug,
}: {
  control: PackExportControl
  gameSlug: string | null | undefined
}): JSX.Element {
  const pending = control.state.status === 'pending'
  return (
    <button
      type="button"
      data-testid="renderer-pack-button"
      className={`renderer-drawer-pill__button${pending ? ' is-disabled' : ''}`}
      title={sceneT('preview.packExport')}
      aria-label={sceneT('preview.packExport')}
      aria-disabled={pending}
      onClick={() => control.run(gameSlug)}
    >
      <PackingBox size={17} />
    </button>
  )
}

export function PackExportPopover({ control }: { control: PackExportControl }): JSX.Element | null {
  const { state } = control
  if (state.status === 'idle') return null
  if (state.status === 'pending') {
    return (
      <div className="renderer-export-popover renderer-shot-popover" role="status" aria-live="polite">
        <div className="renderer-export-popover__title">{sceneT('preview.packPending')}</div>
      </div>
    )
  }
  const failed = state.status === 'error'
  return (
    <div
      className={`renderer-export-popover renderer-shot-popover${failed ? ' renderer-export-popover--error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="renderer-export-popover__close"
        aria-label={sceneT('preview.packClose')}
        onClick={control.dismiss}
      >
        ×
      </button>
      {state.status === 'error' ? (
        <>
          <div className="renderer-export-popover__title">{sceneT('preview.packFailed')}</div>
          <div className="renderer-export-popover__message" title={state.message}>
            {state.message}
          </div>
        </>
      ) : (
        <>
          <div className="renderer-export-popover__title">{sceneT('preview.packDone')}</div>
          <div className="renderer-export-popover__message" title={state.result.path}>
            {state.result.gameSlug}/{state.result.relPath}
          </div>
          <div className="renderer-export-popover__message">
            {sceneT('preview.packCounts', {
              meshes: state.result.meshCount,
              vertices: state.result.vertexCount,
              triangles: state.result.triangleCount,
              seconds: (state.result.verifyMs / 1000).toFixed(1),
            })}
          </div>
          <label className="renderer-export-popover__field">
            <span>{sceneT('preview.packSceneGuid')}</span>
            <textarea
              className="renderer-shot-popover__data"
              aria-label={sceneT('preview.packSceneGuid')}
              readOnly
              rows={1}
              value={state.result.sceneGuid}
              onFocus={selectAllText}
              onClick={selectAllText}
            />
          </label>
          {state.result.diagnostics.length > 0 && (
            <div className="renderer-export-popover__message">
              {sceneT('preview.packDiagnostics', { count: state.result.diagnostics.length })}
              {state.result.diagnostics.slice(0, 3).map((item, index) => (
                <div key={`${item.code}-${index}`} title={item.message}>
                  {item.severity} {item.code}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
