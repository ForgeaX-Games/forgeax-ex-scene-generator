import { useCallback, useRef, useState } from 'react'
import type { BakedHistoryStatusDTO } from '../renderer/bridge/bakedApi.js'
import type { BrushMode, PreviewEditContextBus, PreviewEditTool } from '../surfaces/library/editToolbarBus.js'
import type { SelectedLayerSnapshot } from '../surfaces/library/layerInspector.js'
import { PreviewLayerInspector } from './PreviewLayerInspector.js'

/** Result of the "截图（去背景）" request the left pane sends to the renderer pane. */
export type PreviewScreenshotState =
  | { status: 'idle' }
  | { status: 'pending' }
  | {
      status: 'success'
      dataUrl: string
      width: number
      height: number
      sourceWidth: number
      sourceHeight: number
      cropped: boolean
    }
  | { status: 'error'; message: string }

interface Props {
  editMode: boolean
  editTool: PreviewEditTool
  brushMode: BrushMode
  editZ: number
  previewContext: PreviewEditContextBus
  bakedHistory: BakedHistoryStatusDTO | null
  selectedLayers: SelectedLayerSnapshot[]
  screenshot: PreviewScreenshotState
  onPickTool: (tool: PreviewEditTool) => void
  onPickBrush: (mode: BrushMode) => void
  onUpdateEditZ: (value: number) => void
  onUndoBakedEdit: () => void
  onRedoBakedEdit: () => void
  onCaptureScreenshot: () => void
  onDismissScreenshot: () => void
}

type EditToolsProps = Omit<Props, 'selectedLayers'>

const LS_KEY = 'scene-generator.preview-controls-heights'
const LS_COLLAPSED_KEY = 'scene-generator.preview-controls-collapsed'
const MIN_H = 48
const DEFAULTS = { editTools: 180, selectedLayer: 280, help: 140 }

type SectionKey = 'editTools' | 'selectedLayer' | 'help'
interface Heights { editTools: number; selectedLayer: number; help: number }
interface Collapsed { editTools: boolean; selectedLayer: boolean; help: boolean }

function loadCollapsed(): Collapsed {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      return {
        editTools: o.editTools === true,
        selectedLayer: o.selectedLayer === true,
        help: o.help === true,
      }
    }
  } catch { /* ignore */ }
  return { editTools: false, selectedLayer: false, help: false }
}

function saveCollapsed(c: Collapsed): void {
  try { localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

function loadHeights(): Heights {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      return {
        editTools: Math.max(MIN_H, typeof o.editTools === 'number' ? o.editTools : DEFAULTS.editTools),
        selectedLayer: Math.max(MIN_H, typeof o.selectedLayer === 'number' ? o.selectedLayer : DEFAULTS.selectedLayer),
        help: Math.max(MIN_H, typeof o.help === 'number' ? o.help : DEFAULTS.help),
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

function saveHeights(h: Heights): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(h)) } catch { /* ignore */ }
}

export function PreviewControlsPanel({
  editMode,
  editTool,
  brushMode,
  editZ,
  previewContext,
  bakedHistory,
  selectedLayers,
  screenshot,
  onPickTool,
  onPickBrush,
  onUpdateEditZ,
  onUndoBakedEdit,
  onRedoBakedEdit,
  onCaptureScreenshot,
  onDismissScreenshot,
}: Props): JSX.Element {
  const [heights, setHeights] = useState<Heights>(loadHeights)
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed)

  const toggleCollapsed = useCallback((key: SectionKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveCollapsed(next)
      return next
    })
  }, [])

  const resize = useCallback((key: keyof Heights, dy: number) => {
    setHeights((prev) => {
      const next = { ...prev, [key]: Math.max(MIN_H, prev[key] + dy) }
      saveHeights(next)
      return next
    })
  }, [])

  return (
    <div className="editor-controls-panel preview-controls-panel">
      <div
        className="editor-controls__section"
        style={collapsed.editTools ? undefined : { height: heights.editTools }}
      >
        <SectionTitle
          label="Edit tools"
          collapsed={collapsed.editTools}
          onToggle={() => toggleCollapsed('editTools')}
        />
        {!collapsed.editTools && (
          <div className="editor-controls__section-content preview-controls-panel__content">
            <EditToolsSection
              editMode={editMode}
              editTool={editTool}
              brushMode={brushMode}
              editZ={editZ}
              previewContext={previewContext}
              bakedHistory={bakedHistory}
              screenshot={screenshot}
              onPickTool={onPickTool}
              onPickBrush={onPickBrush}
              onUpdateEditZ={onUpdateEditZ}
              onUndoBakedEdit={onUndoBakedEdit}
              onRedoBakedEdit={onRedoBakedEdit}
              onCaptureScreenshot={onCaptureScreenshot}
              onDismissScreenshot={onDismissScreenshot}
            />
          </div>
        )}
      </div>

      <div
        className="editor-controls__section"
        style={collapsed.selectedLayer ? undefined : { height: heights.selectedLayer }}
      >
        <DragTitle
          label="Selected layer"
          collapsed={collapsed.selectedLayer}
          onToggle={() => toggleCollapsed('selectedLayer')}
          onDrag={(dy) => resize('editTools', dy)}
        />
        {!collapsed.selectedLayer && (
          <div className="editor-controls__section-content preview-controls-panel__content">
            <PreviewLayerInspector layers={selectedLayers} />
          </div>
        )}
      </div>

      <div
        className="editor-controls__section"
        style={collapsed.help ? undefined : { height: heights.help }}
      >
        <DragTitle
          label="Help"
          collapsed={collapsed.help}
          onToggle={() => toggleCollapsed('help')}
          onDrag={(dy) => resize('selectedLayer', dy)}
        />
        {!collapsed.help && (
          <div className="editor-controls__section-content preview-controls-panel__content">
            <div className="scene-left-pane__help">
              <p>
                Ask the agent to add a scene_output sink, explain selected node wiring, or generate a starter room layout.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EditToolsSection({
  editMode,
  editTool,
  brushMode,
  editZ,
  previewContext,
  bakedHistory,
  screenshot,
  onPickTool,
  onPickBrush,
  onUpdateEditZ,
  onUndoBakedEdit,
  onRedoBakedEdit,
  onCaptureScreenshot,
  onDismissScreenshot,
}: EditToolsProps): JSX.Element {
  // Screenshot works in any view, so it sits above the edit-mode gate.
  const screenshotTool = (
    <ScreenshotTool
      screenshot={screenshot}
      onCapture={onCaptureScreenshot}
      onDismiss={onDismissScreenshot}
    />
  )

  if (!editMode) {
    return (
      <>
        {screenshotTool}
        <p className="scene-left-pane__hint">Enable edit mode in the Preview toolbar to show brush controls.</p>
      </>
    )
  }

  return (
    <>
      {screenshotTool}
      <div className="scene-left-pane__brush-modes" role="group" aria-label="Edit tool">
        {([
          ['paint', 'Paint'],
          ['erase', 'Eraser'],
          ['eyedropper', 'Eyedropper'],
          ['select', 'Select'],
        ] as const).map(([tool, label]) => (
          <button
            key={tool}
            type="button"
            className={`scene-left-pane__brush-btn${editTool === tool ? ' is-active' : ''}`}
            aria-pressed={editTool === tool}
            disabled={!previewContext.editAvailable}
            onClick={() => onPickTool(tool)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="scene-left-pane__brush-modes" role="group" aria-label="Brush mode">
        <button
          type="button"
          className={`scene-left-pane__brush-btn${brushMode === 'free' ? ' is-active' : ''}`}
          aria-pressed={brushMode === 'free'}
          onClick={() => onPickBrush('free')}
        >
          Free brush
        </button>
        <button
          type="button"
          className={`scene-left-pane__brush-btn${brushMode === 'box' ? ' is-active' : ''}`}
          aria-pressed={brushMode === 'box'}
          onClick={() => onPickBrush('box')}
        >
          Box select
        </button>
      </div>
      {previewContext.editAvailable && (
        <label className="scene-left-pane__toolbar-row scene-left-pane__toolbar-row--z">
          <span>Z Layer</span>
          <span className="scene-left-pane__z-control">
            <button type="button" onClick={() => onUpdateEditZ(editZ - 1)} aria-label="Decrease Z layer">-</button>
            <input
              type="number"
              step={1}
              value={editZ}
              onChange={(e) => onUpdateEditZ(Number(e.currentTarget.value))}
              aria-label="Z Layer"
            />
            <button type="button" onClick={() => onUpdateEditZ(editZ + 1)} aria-label="Increase Z layer">+</button>
          </span>
        </label>
      )}
      <div className="scene-left-pane__brush-modes" role="group" aria-label="Baked edit history">
        <button
          type="button"
          className="scene-left-pane__brush-btn"
          disabled={!bakedHistory?.canUndo}
          title={bakedHistory?.undoLabel ? `Undo ${bakedHistory.undoLabel}` : 'Undo baked edit'}
          onClick={onUndoBakedEdit}
        >
          Undo
        </button>
        <button
          type="button"
          className="scene-left-pane__brush-btn"
          disabled={!bakedHistory?.canRedo}
          title={bakedHistory?.redoLabel ? `Redo ${bakedHistory.redoLabel}` : 'Redo baked edit'}
          onClick={onRedoBakedEdit}
        >
          Redo
        </button>
      </div>
      <div className="scene-left-pane__help" aria-label="Recent baked edits">
        {bakedHistory?.entries.length ? (
          <ul>
            {bakedHistory.entries.slice(0, 5).map((entry) => (
              <li key={entry.id}>{entry.label}</li>
            ))}
          </ul>
        ) : (
          <p>No baked edits yet</p>
        )}
      </div>
      <p className="scene-left-pane__hint">
        {previewContext.editAvailable
          ? 'Billboard + Asset mode: pick a layer and asset, then paint.'
          : 'Switch to Billboard view and Asset draw mode to paint.'}
      </p>
    </>
  )
}

/**
 * Mirrors the Preview toolbar's camera button, with the frame cropped to its
 * non-transparent bounding box. The canvas lives in the renderer pane, so the
 * click only publishes a request on screenshotBus; the answer arrives as a PNG
 * data URL (the sandboxed studio iframe blocks clipboard writes and downloads,
 * so a copyable data URL + right-clickable thumbnail is the usable form).
 */
function ScreenshotTool({
  screenshot,
  onCapture,
  onDismiss,
}: {
  screenshot: PreviewScreenshotState
  onCapture: () => void
  onDismiss: () => void
}): JSX.Element {
  const selectAllText = (e: React.FocusEvent<HTMLTextAreaElement> | React.MouseEvent<HTMLTextAreaElement>): void => {
    e.currentTarget.select()
  }

  return (
    <>
      <div className="scene-left-pane__brush-modes" role="group" aria-label="Preview screenshot">
        <button
          type="button"
          className="scene-left-pane__brush-btn"
          title="截取 Preview 当前画面，并裁掉四周没有像素的背景"
          disabled={screenshot.status === 'pending'}
          onClick={onCapture}
        >
          {screenshot.status === 'pending' ? '截图中…' : '截图（去背景）'}
        </button>
      </div>
      {screenshot.status === 'success' && (
        <div className="scene-left-pane__shot" role="status" aria-live="polite">
          <div className="scene-left-pane__shot-head">
            <span>
              {screenshot.width}×{screenshot.height}
              {screenshot.cropped
                ? `（原 ${screenshot.sourceWidth}×${screenshot.sourceHeight}）`
                : '（未裁剪：无法读取像素）'}
            </span>
            <button
              type="button"
              className="scene-left-pane__shot-close"
              aria-label="Close screenshot result"
              onClick={onDismiss}
            >
              X
            </button>
          </div>
          <img
            className="scene-left-pane__shot-preview"
            src={screenshot.dataUrl}
            alt={`Preview screenshot ${screenshot.width}×${screenshot.height}`}
          />
          <label className="scene-left-pane__shot-field">
            <span>选中并复制这段 PNG data URL（或右键图片 → 复制/另存为）:</span>
            <textarea
              className="scene-left-pane__shot-data"
              aria-label="Screenshot PNG data URL"
              readOnly
              rows={3}
              value={screenshot.dataUrl}
              onFocus={selectAllText}
              onClick={selectAllText}
            />
          </label>
        </div>
      )}
      {screenshot.status === 'error' && (
        <div className="scene-left-pane__shot scene-left-pane__shot--error" role="status" aria-live="polite">
          <div className="scene-left-pane__shot-head">
            <span>截图失败</span>
            <button
              type="button"
              className="scene-left-pane__shot-close"
              aria-label="Close screenshot result"
              onClick={onDismiss}
            >
              X
            </button>
          </div>
          <p title={screenshot.message}>{screenshot.message}</p>
        </div>
      )}
    </>
  )
}

function SectionTitle({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="editor-controls__title"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <CollapseTriangle collapsed={collapsed} />
      <span>{label}</span>
    </button>
  )
}

function DragTitle({
  label,
  collapsed,
  onToggle,
  onDrag,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  onDrag: (dy: number) => void
}): JSX.Element {
  const lastYRef = useRef<number | null>(null)
  const draggedRef = useRef(false)

  return (
    <button
      type="button"
      className="editor-controls__title is-draggable"
      aria-expanded={!collapsed}
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false
          return
        }
        onToggle()
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        lastYRef.current = e.clientY
        draggedRef.current = false
      }}
      onPointerMove={(e) => {
        if (lastYRef.current === null) return
        const dy = e.clientY - lastYRef.current
        if (dy !== 0) {
          draggedRef.current = true
          onDrag(dy)
        }
        lastYRef.current = e.clientY
      }}
      onPointerUp={() => { lastYRef.current = null }}
      onPointerCancel={() => { lastYRef.current = null }}
    >
      <CollapseTriangle collapsed={collapsed} />
      <span>{label}</span>
    </button>
  )
}

function CollapseTriangle({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <span className={`section-collapse-toggle${collapsed ? ' is-collapsed' : ''}`} aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path
          d={collapsed ? 'M3 1L7 5L3 9' : 'M1 3L5 7L9 3'}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
