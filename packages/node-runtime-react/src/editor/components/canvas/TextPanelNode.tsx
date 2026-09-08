// TextPanel special node, in Panel style: supports double-click editing and
// edge-drag resizing. Ported from the legacy editor (components/canvas/TextPanelNode.tsx).
// The legacy bookmark icon (lucide-react) is replaced with an inline SVG to keep
// the package dependency-free; the markup/CSS class is preserved.
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import type { NodeProps } from '../../xyflow.js'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import { peekEditorTransport } from '../../transport/index.js'
import { ContextMenuPortal, type ContextMenuState } from './BatteryNode.js'
import { getRealNodeIdFromContext } from './groupBoundaryIds.js'
import { getPortTypeColor, normalizeType } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { compactGridArrays } from '../../utils/gridFormat.js'
import { peelWireValue } from '../../utils/datatreeShape.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  hasUpstreamEdgeForPort,
  resolveInputPortValue,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './TextPanelNode.css'

/** Inline bookmark icon (replaces the legacy lucide-react Bookmark). */
function BookmarkIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

interface TextPanelNodeData {
  battery: {
    id: string
    name: string
    type?: string
    nameEn?: string
    version?: string
    category?: string
    description?: string
    descriptionEn?: string
    inputs: Array<{ name: string; type: string; label?: string; description?: string; descriptionEn?: string; default?: unknown }>
    outputs: Array<{ name: string; type: string; label?: string; description?: string; descriptionEn?: string }>
  }
  params: Record<string, unknown>
}

// How long after the last keystroke (typing stops) before the new value is pushed
// downstream. AI streaming output flows through nodeOutputs / upstream edges and
// is unaffected by this debounce.
const TEXT_DEBOUNCE_MS = 4000

/**
 * Render an upstream single value (after peelWireValue has stripped the wire
 * wrapper) into the text the TextPanel wants to show.
 *   - string / number / boolean: String()
 *   - other object / array: pretty JSON (keeps structure for copying)
 * This is TextPanel-specific and is not shared; NameListPanel etc. have their own.
 */
function stringifyForPanel(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  // JSON.stringify(()=>{}) returns undefined (not a throw) and must not be
  // returned directly, otherwise the string-typed signature mismatches the
  // runtime undefined and a later .split would crash.
  try {
    const s = JSON.stringify(val, null, 2)
    return typeof s === 'string' ? s : String(val)
  } catch {
    return String(val)
  }
}

function panelTextFromParams(params: Record<string, unknown> | undefined): string {
  if (typeof params?.text === 'string' && params.text.trim()) return params.text
  // Agents sometimes write number_const's `value` key onto text_panel.
  if (typeof params?.value === 'string') return params.value
  if (typeof params?.text === 'string') return params.text
  return ''
}

function TextPanelNode({ id, data, selected, dragging }: NodeProps<TextPanelNodeData>) {
  const { params } = data
  const [isEditing, setIsEditing] = useState(false)
  const [localText, setLocalText] = useState(panelTextFromParams(params))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Debounce timer that triggers downstream execution from keyboard input.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Whether there is pending text awaiting flush (checked on blur/unmount).
  const pendingFlushRef = useRef(false)
  // Last param text we have already reflected locally — used to tell a genuine
  // external write apart from a stale / echoed snapshot prop (see the sync effect).
  const lastSeenParamTextRef = useRef(panelTextFromParams(params))

  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs)
  const addTextPreset = useUIStore((s) => s.addTextPreset)
  const addPrompt = useUIStore((s) => s.addPrompt)
  // Save button animation state: idle / saved (green) / empty (red shake).
  const [saveAnim, setSaveAnim] = useState<'idle' | 'saved' | 'empty'>('idle')
  // Title-input popover for saving the current text as a named preset.
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [presetTitle, setPresetTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  // Right-click context menu + the "Save as Prompt" name dialog.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showPromptDialog, setShowPromptDialog] = useState(false)
  const [promptName, setPromptName] = useState('')
  const [promptTag, setPromptTag] = useState('')
  const promptNameInputRef = useRef<HTMLInputElement>(null)
  // Determine whether the input port has an upstream link via the edge table
  // (not via the output result), to avoid hasInput being misjudged true after
  // execution writes nodeOutputs, which would disable editing. Group inner
  // views keep their wiring in the group's own edge table, so this must go
  // through the shared lookup — reading root edges alone made a wired panel
  // inside a group fall back to its (empty) local text.
  const hasUpstreamEdge = usePipelineStore((s) => hasUpstreamEdgeForPort(s, id, 'input'))
  const langMode = useUIStore(s => s.langMode)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  const outputValue = nodeOutputs[getRealNodeIdFromContext(id)]?.output
  // The wire form [{path, items:[T]}] makes String() emit "[object Object]";
  // peel to a single item first, then stringify. Multi branch / multi item (rare,
  // TextPanel upstream access:item is almost always a single cell) goes through
  // JSON serialization to keep structure.
  const peeledOutput = peelWireValue(outputValue)
  // A wired panel whose own output has not been hydrated yet (inner group nodes
  // hydrate lazily) still belongs to the upstream, so show the upstream value
  // rather than the empty local text.
  const shownValue =
    peeledOutput !== undefined && peeledOutput !== null
      ? peeledOutput
      : hasUpstreamEdge
        ? peelWireValue(resolveInputPortValue(id, 'input'))
        : undefined
  const hasInput = hasUpstreamEdge && shownValue !== undefined && shownValue !== null
  const rawDisplayText = hasInput ? stringifyForPanel(shownValue) : localText
  const displayText = compactGridArrays(rawDisplayText)
  // What "save as preset / prompt" stores: exactly what the panel shows — the
  // row-per-line compact form, not the pretty-printed JSON behind it. Storing
  // the raw form made a preset dropped back onto the canvas read as a
  // digit-per-line wall of text the moment it was opened for editing.
  const savableText = displayText

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasInput) return
    // Edit what is displayed: the textarea would otherwise reveal the
    // uncompacted source (one digit per line) that the read-only view compacts.
    setLocalText((prev) => compactGridArrays(prev))
    setIsEditing(true)
  }, [hasInput])

  const handleFocus = useCallback(() => {
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('edit_text', currentPipeline, {
        nodeIds: [id],
        label: `编辑文本：${data.battery?.name ?? id}`,
        labelEn: `Edit text: ${data.battery?.nameEn ?? (data.battery?.id ? formatIdAsLabel(data.battery.id) : id)}`,
      })
    }
  }, [id, data.battery?.name])

  // Immediately push the current localText downstream (cancel the pending debounce
  // and trigger one downstream execution).
  //
  // This must NOT go through the non-silent updateNodeParam path: silent=true has
  // already written the latest text into the store (handleChange does this on each
  // keystroke), so calling updateNodeParam would see Object.is(stored, latest) ===
  // true and early-return without triggering incrementalExecute. That bug is the
  // root cause of "panel input needs a refresh to take effect": on debounce / blur
  // / unmount fire, downstream never receives the new value.
  // Correct approach: call incrementalExecute directly, bypassing updateNodeParam's
  // early-return.
  const flushTextNow = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (!pendingFlushRef.current) return
    pendingFlushRef.current = false
    void usePipelineStore.getState().incrementalExecute(id, false)
  }, [id])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    flushTextNow()
  }, [flushTextNow])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setLocalText(value)
    // Sync to store immediately (silent=true: UI / refresh / AI node manual run all
    // read the latest value), without triggering execution.
    updateNodeParam(id, 'text', value, true)
    pendingFlushRef.current = true
    if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      if (!pendingFlushRef.current) return
      pendingFlushRef.current = false
      // Call incrementalExecute directly; see flushTextNow on the Object.is early-return.
      void usePipelineStore.getState().incrementalExecute(id, false)
    }, TEXT_DEBOUNCE_MS)
  }, [id, updateNodeParam])

  useEffect(() => {
    return () => {
      // On unmount, if input is still pending, flush downstream immediately to
      // avoid losing data.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
        if (pendingFlushRef.current) {
          pendingFlushRef.current = false
          void usePipelineStore.getState().incrementalExecute(id, false)
        }
      }
    }
  }, [id])

  // External applyBatch / store updates may heal `value`→`text`; keep UI in sync
  // when the user is not actively typing. Typing writes to the store silently,
  // so this prop only catches up on the next committed rebuild (a param-edit
  // persist is self-echo-suppressed and may never trigger one) — re-applying an
  // unchanged prop on blur would therefore wipe what the user just typed. Only
  // adopt a value when the prop itself changed, never merely because edit mode
  // toggled.
  useEffect(() => {
    const incoming = panelTextFromParams(params)
    if (incoming === lastSeenParamTextRef.current) return
    lastSeenParamTextRef.current = incoming
    if (isEditing) return
    setLocalText(incoming)
  }, [params.text, params.value, isEditing])

  // Open the title-input popover (or shake when empty). The actual save happens
  // on confirm, where we have the user-entered title.
  const handleSavePreset = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!savableText.trim()) {
      setSaveAnim('empty')
      setTimeout(() => setSaveAnim('idle'), 800)
      return
    }
    setPresetTitle('')
    setShowSaveDialog(true)
  }, [savableText])

  // Confirm: persist the preset with the entered title (empty title is allowed —
  // the backend stores it and the rail falls back to showing the text).
  const handleConfirmSavePreset = useCallback(() => {
    const title = presetTitle.trim()
    addTextPreset(savableText, title || undefined)
    setShowSaveDialog(false)
    setSaveAnim('saved')
    setTimeout(() => setSaveAnim('idle'), 1000)
  }, [savableText, presetTitle, addTextPreset])

  const handleCancelSavePreset = useCallback(() => {
    setShowSaveDialog(false)
  }, [])

  // ── Right-click menu: Save as Preset (universal) + Save as Prompt (only when
  //    the active transport backs prompt routes, i.e. the asset app). ─────────
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    hide()
    const supportsPrompts = peekEditorTransport()?.api.supportsPrompts === true
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      nodeIds: [id],
      previewEnabled: true,
      hidePreview: true,
      extraItems: [
        {
          label: langMode === 'zh' ? '保存为预设' : 'Save as Preset',
          onClick: () => {
            if (!savableText.trim()) {
              setSaveAnim('empty')
              setTimeout(() => setSaveAnim('idle'), 800)
              return
            }
            setPresetTitle('')
            setShowSaveDialog(true)
          },
        },
        ...(supportsPrompts
          ? [
              {
                label: langMode === 'zh' ? '保存为提示词' : 'Save as Prompt',
                onClick: () => {
                  if (!savableText.trim()) {
                    setSaveAnim('empty')
                    setTimeout(() => setSaveAnim('idle'), 800)
                    return
                  }
                  setPromptName('')
                  setPromptTag('')
                  setShowPromptDialog(true)
                },
              },
            ]
          : []),
      ],
    })
  }, [id, langMode, savableText, hide])

  const handleConfirmSavePrompt = useCallback(() => {
    addPrompt(savableText, promptName.trim() || undefined, promptTag.trim() || undefined)
    setShowPromptDialog(false)
    setSaveAnim('saved')
    setTimeout(() => setSaveAnim('idle'), 1000)
  }, [savableText, promptName, promptTag, addPrompt])

  const handleCancelSavePrompt = useCallback(() => {
    setShowPromptDialog(false)
  }, [])

  useEffect(() => {
    if (showSaveDialog && titleInputRef.current) {
      titleInputRef.current.focus()
    }
  }, [showSaveDialog])

  useEffect(() => {
    if (showPromptDialog && promptNameInputRef.current) {
      promptNameInputRef.current.focus()
    }
  }, [showPromptDialog])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [isEditing])

  const inputColor = getPortTypeColor('any')
  const outputColor = getPortTypeColor('string')

  const showInputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const inp = data.battery.inputs[0]
    if (!inp) return
    const canonical = normalizeType(inp.type)
    const inputVal = resolveInputPortValue(id, inp.name)
    const valueLine = inputVal !== undefined
      ? { label: 'value:', text: formatPortValue(inputVal), extra: formatPortValueExtra(inputVal) }
      : inp.default !== undefined
        ? { label: 'default:', text: formatPortValue(inp.default), extra: formatPortValueExtra(inp.default), muted: true as const }
        : undefined
    const portDesc = langMode === 'zh' ? inp.description : (inp.descriptionEn || inp.description)
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (inp.label ?? inp.name) : inp.name,
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1), subtitleColor: getPortTypeColor(canonical),
      description: portDesc, valueLine,
    })
  }, [id, langMode, data.battery.inputs, showImmediate])

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const out = data.battery.outputs[0]
    if (!out) return
    const canonical = normalizeType(out.type)
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.[out.name]
    const valueLine = outputVal !== undefined
      ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
      : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true as const }
    const portDesc = langMode === 'zh' ? out.description : (out.descriptionEn || out.description)
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (out.label ?? out.name) : out.name,
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1), subtitleColor: getPortTypeColor(canonical),
      description: portDesc, valueLine,
    })
  }, [id, langMode, data.battery.outputs, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh' ? data.battery.description : (data.battery.descriptionEn || data.battery.description)
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : (data.battery.nameEn || formatIdAsLabel(data.battery.id)),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type ?? '', data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type ?? ''),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  return (
    <div
      className={[
        'text-panel-node',
        selected ? 'selected' : '',
        isEditing ? 'editing' : '',
        hasInput ? 'has-input' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      <NodeResizer
        minWidth={120}
        minHeight={60}
        isVisible={selected}
        lineClassName="text-panel-resize-line"
        handleClassName="text-panel-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('text-panel-resize')
        }}
      />

      {/* Input port: left-center, events bound directly on the Handle to avoid a
          wrapper breaking ReactFlow positioning. */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{
          background: inputColor,
          border: `2px solid ${inputColor}`,
          width: 10,
          height: 10,
        }}
        onMouseEnter={showInputPortTooltip}
        onMouseLeave={hide}
      />

      {/* Title bar. */}
      <div className="text-panel-header">
        <span className="text-panel-title">
          {langMode === 'zh'
            ? (data.battery?.name || '面板')
            : (data.battery?.nameEn || formatIdAsLabel(data.battery?.id || 'text_panel'))}
        </span>
        {/* Save-as-preset button: available for hand-typed AND upstream-driven
            panels (an upstream result is just as worth keeping as typed text). */}
        <button
          className={`text-panel-save-btn${saveAnim !== 'idle' ? ` text-panel-save-btn--${saveAnim}` : ''}`}
          onClick={handleSavePreset}
          title={saveAnim === 'empty' ? 'Text is empty, cannot save' : 'Save as preset'}
        >
          <BookmarkIcon size={10} />
        </button>
      </div>

      {/* Body area. */}
      <div
        className="text-panel-body"
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="text-panel-textarea nodrag nowheel"
            value={localText}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={e => e.stopPropagation()}
            spellCheck={false}
          />
        ) : (
          <div className="text-panel-content">
            {displayText
              ? displayText.split('\n').map((line, i) => (
                  <span key={i} className="text-panel-line">{line}</span>
                ))
              : <span className="text-panel-placeholder">Double-click to enter text…</span>
            }
          </div>
        )}
      </div>

      {/* Output port: right-center. */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        style={{
          background: outputColor,
          border: `2px solid ${outputColor}`,
          width: 10,
          height: 10,
        }}
        onMouseEnter={showOutputPortTooltip}
        onMouseLeave={hide}
      />

      {tooltip && <TooltipPortal tooltip={tooltip} />}

      {contextMenu && (
        <ContextMenuPortal menu={contextMenu} onClose={closeContextMenu} onAction={() => {}} />
      )}

      {/* Save-as-prompt dialog: name input → addPrompt (server parses [xxx]
          placeholders into str input ports). Same modal chrome as the preset
          dialog. */}
      {showPromptDialog && createPortal(
        <div
          className="tp-save-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleCancelSavePrompt()
          }}
        >
          <div className="tp-save-modal nodrag nowheel">
            <div className="tp-save-header">
              <span className="tp-save-title">
                {langMode === 'zh' ? '保存为提示词' : 'Save as Prompt'}
              </span>
              <button
                type="button"
                className="tp-save-close"
                onClick={handleCancelSavePrompt}
                aria-label={langMode === 'zh' ? '关闭' : 'Close'}
              >
                ✕
              </button>
            </div>

            <div className="tp-save-body">
              <label className="tp-save-label">
                {langMode === 'zh' ? '提示词名称' : 'Prompt name'}
              </label>
              <input
                ref={promptNameInputRef}
                className="tp-save-input"
                type="text"
                value={promptName}
                placeholder={langMode === 'zh' ? '输入名称…' : 'Enter a name…'}
                onChange={(e) => setPromptName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleConfirmSavePrompt()
                  else if (e.key === 'Escape') handleCancelSavePrompt()
                }}
              />
              <label className="tp-save-label">
                {langMode === 'zh' ? '小标签（可选）' : 'Sub-tag (optional)'}
              </label>
              <input
                className="tp-save-input"
                type="text"
                value={promptTag}
                placeholder={langMode === 'zh' ? '默认 saved' : 'Default: saved'}
                onChange={(e) => setPromptTag(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleConfirmSavePrompt()
                  else if (e.key === 'Escape') handleCancelSavePrompt()
                }}
              />
            </div>

            <div className="tp-save-footer">
              <button
                type="button"
                className="tp-save-btn tp-save-btn--cancel"
                onClick={handleCancelSavePrompt}
              >
                {langMode === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                className="tp-save-btn tp-save-btn--save"
                onClick={handleConfirmSavePrompt}
              >
                {langMode === 'zh' ? '保存' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Save-as-preset dialog: rendered via a portal to <body> (escaping the
          node's overflow:hidden + ReactFlow transform) as a centered, blurred-
          backdrop modal — same pattern as GroupSaveDialog — but styled in the
          Panel node's green theme. */}
      {showSaveDialog && createPortal(
        <div
          className="tp-save-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleCancelSavePreset()
          }}
        >
          <div className="tp-save-modal nodrag nowheel">
            <div className="tp-save-header">
              <span className="tp-save-title">
                {langMode === 'zh' ? '保存为预设' : 'Save as Preset'}
              </span>
              <button
                type="button"
                className="tp-save-close"
                onClick={handleCancelSavePreset}
                aria-label={langMode === 'zh' ? '关闭' : 'Close'}
              >
                ✕
              </button>
            </div>

            <div className="tp-save-body">
              <label className="tp-save-label">
                {langMode === 'zh' ? '预设标题' : 'Preset title'}
              </label>
              <input
                ref={titleInputRef}
                className="tp-save-input"
                type="text"
                value={presetTitle}
                placeholder={langMode === 'zh' ? '输入标题…' : 'Enter a title…'}
                onChange={(e) => setPresetTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleConfirmSavePreset()
                  else if (e.key === 'Escape') handleCancelSavePreset()
                }}
              />
            </div>

            <div className="tp-save-footer">
              <button
                type="button"
                className="tp-save-btn tp-save-btn--cancel"
                onClick={handleCancelSavePreset}
              >
                {langMode === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                className="tp-save-btn tp-save-btn--save"
                onClick={handleConfirmSavePreset}
              >
                {langMode === 'zh' ? '保存' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default memo(TextPanelNode)
