import { useEffect, useRef, useState } from 'react'
import {
  generatedAssetUrl,
  latestPreviewAsset,
  listGeneratedAssets,
  type GeneratedAssetRecord,
} from './generatedAssetsApi.js'
import { subscribeSelectedPreview } from './library/selectedPreviewBus.js'
import { useWorkbenchChild } from '../workbench/useWorkbenchChild.js'
import { Maximize2, Minimize2 } from './icons.js'
import './ImagePreviewSurface.css'

// The backend `folder` already encodes the rail hierarchy as a path
// (`top` or `top/child`), so for a sub-menu it is naturally shown as `xx/xx`.
// Empty/missing folder = the implicit root bucket.
function formatLocation(folder: string | undefined | null): string {
  const value = folder?.trim()
  return value || 'All Images'
}

// The record's `createdAt` is an ISO timestamp; show it as a readable local
// date-time. Falls back to the raw value (or '-') if it isn't parseable.
function formatCreatedAt(createdAt: string | undefined | null): string {
  if (!createdAt) return '-'
  const ms = Date.parse(createdAt)
  if (Number.isNaN(ms)) return createdAt
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function ImagePreviewSurface(): JSX.Element {
  const [selected, setSelected] = useState<GeneratedAssetRecord | null>(null)
  const [error, setError] = useState('')
  // Natural pixel dimensions of the currently shown image, read from the <img>
  // on load (the backend record carries no width/height). Reset on selection
  // change so a stale size never lingers between assets.
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const { isFocused, requestFocus, reportStatus } = useWorkbenchChild('renderer')
  // Tracks the latest preview asset we've already reacted to. A background
  // detector switches the preview ONLY when a genuinely new asset appears
  // (alias changes), so manual Asset Store clicks are never overwritten.
  const lastSeenLatestAlias = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listGeneratedAssets()
      .then((items) => {
        if (cancelled) return
        setSelected((cur) => cur ?? items[0] ?? null)
        reportStatus({ layers: items.length, viewMode: 'image' })
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [reportStatus])

  // Cross-iframe: when the user clicks an image in the Asset Store, show it here.
  // We must NOT touch lastSeenLatestAlias — that ref tracks the background
  // `/preview/latest` baseline. Overwriting it with the clicked alias makes the
  // next poll see the genuine latest asset as "new" and switch back, reverting
  // the user's click after ~1–2s.
  useEffect(() => {
    return subscribeSelectedPreview((alias) => {
      // The unfiltered list includes every real asset plus all presets (across
      // their sub-folders), so a single fetch resolves any clicked alias and
      // carries the record's true `folder` for the Location row.
      void listGeneratedAssets()
        .then((items) => {
          const match = items.find((item) => item.alias === alias)
          if (match) setSelected(match)
        })
        .catch(() => {})
    })
  }, [])

  useEffect(() => {
    const detectNewAsset = (): void => {
      void latestPreviewAsset()
        .then((asset) => {
          if (!asset) return
          // First detection just records the baseline — never auto-switch on
          // mount (that would steal the initial items[0] / user's selection).
          if (lastSeenLatestAlias.current === null) {
            lastSeenLatestAlias.current = asset.alias
            return
          }
          // Only a brand-new asset (alias changed) triggers a single switch.
          if (asset.alias !== lastSeenLatestAlias.current) {
            lastSeenLatestAlias.current = asset.alias
            setSelected(asset)
          }
        })
        .catch(() => {})
    }
    const timer = window.setInterval(detectNewAsset, 2000)
    return () => window.clearInterval(timer)
  }, [])

  // Clear the last-known dimensions whenever the shown asset changes so the
  // Size row reflects the new image only after its own load event fires.
  useEffect(() => {
    setDimensions(null)
  }, [selected?.alias])

  return (
    <div className="asset2d-preview">
      <div className="asset2d-preview__toolbar">
        <span className="asset2d-preview__title">Preview</span>
        <div className="asset2d-preview__toolbar-spacer" />
        <button
          type="button"
          className={`asset2d-preview__ctrl-btn${isFocused ? ' is-active' : ''}`}
          title={isFocused ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={requestFocus}
        >
          {isFocused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {error && <div className="asset2d-preview__error">{error}</div>}

      <section className="asset2d-preview__body">
        <div className="asset2d-preview__stage">
          {selected ? (
            <>
              <img
                src={generatedAssetUrl(selected.alias)}
                alt={selected.alias}
                onLoad={(e) => {
                  const img = e.currentTarget
                  setDimensions({ width: img.naturalWidth, height: img.naturalHeight })
                }}
              />
              <dl className="asset2d-preview__meta">
                <div className="asset2d-preview__meta-row asset2d-preview__meta-row--full">
                  <div><dt>Alias</dt><dd title={selected.alias}>{selected.alias}</dd></div>
                </div>
                <div className="asset2d-preview__meta-row">
                  <div><dt>Prompt</dt><dd>{selected.prompt ?? '-'}</dd></div>
                  <div><dt>Source</dt><dd>{selected.source ?? '-'}</dd></div>
                </div>
                <div className="asset2d-preview__meta-row">
                  <div><dt>Size</dt><dd>{dimensions ? `${dimensions.width} × ${dimensions.height} px` : '-'}</dd></div>
                  <div><dt>Blob</dt><dd>{selected.blobId.slice(0, 12)}</dd></div>
                </div>
                <div className="asset2d-preview__meta-row">
                  <div><dt>Location</dt><dd title={formatLocation(selected.folder)}>{formatLocation(selected.folder)}</dd></div>
                  <div><dt>Created</dt><dd>{formatCreatedAt(selected.createdAt)}</dd></div>
                </div>
              </dl>
            </>
          ) : (
            <p>Click an image in the Asset Store, or run an AI image node, to preview it here.</p>
          )}
        </div>
      </section>
    </div>
  )
}
