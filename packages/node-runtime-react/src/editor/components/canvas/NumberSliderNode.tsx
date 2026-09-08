// NumberSlider special node, in Number Slider style.
// Interaction: drag the track to change value | double-click to type a value |
// right-click to edit range and precision.
// When wired, the left name cell shows the downstream port name (single link =
// port name, multi = port name xN).
// Ported from the legacy editor (components/canvas/NumberSliderNode.tsx).
import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '../../xyflow.js'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import CustomSelect from './CustomSelect.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import type { Battery } from '../../types.js'
import './NumberSliderNode.css'

const PRECISION_OPTIONS = [
  { value: 0, label: 'Integer (0)' },
  { value: 1, label: '0.0' },
  { value: 2, label: '0.00' },
  { value: 3, label: '0.000' },
  { value: 4, label: '0.0000' },
]

interface NumberSliderNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function NumberSliderNode({ id, data, selected, dragging }: NodeProps<NumberSliderNodeData>) {
  const { params } = data

  const [value, setValue] = useState(typeof params.value === 'number' ? params.value : 0)
  const [min, setMin] = useState(typeof params.min === 'number' ? params.min : 0)
  const [max, setMax] = useState(typeof params.max === 'number' ? params.max : 100)
  const [precision, setPrecision] = useState(typeof params.precision === 'number' ? params.precision : 0)

  // Double-click edit mode.
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  // Context-menu state.
  const [showCtxMenu, setShowCtxMenu] = useState(false)
  const [ctxMenuPos, setCtxMenuPos] = useState({ x: 0, y: 0 })
  const [ctxMin, setCtxMin] = useState('')
  const [ctxMax, setCtxMax] = useState('')
  const [ctxPrecision, setCtxPrecision] = useState(0)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const edges     = usePipelineStore(s => s.currentPipeline?.edges ?? [])
  const pipeNodes = usePipelineStore(s => s.currentPipeline?.nodes ?? [])
  const batteries = usePipelineStore(s => s.batteries)
  const langMode = useUIStore(s => s.langMode)
  const favoriteBatteries = useUIStore(s => s.favoriteBatteries)
  const addFavoriteBattery = useUIStore(s => s.addFavoriteBattery)
  const removeFavoriteBattery = useUIStore(s => s.removeFavoriteBattery)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  // Round a value to the given precision.
  const roundTo = useCallback((v: number, p: number) => {
    const factor = Math.pow(10, p)
    return Math.round(v * factor) / factor
  }, [])

  const commit = useCallback((v: number, p: number = precision, lo: number = min, hi: number = max) => {
    const clamped = Math.min(hi, Math.max(lo, roundTo(v, p)))
    setValue(clamped)
    updateNodeParam(id, 'value', clamped)
  }, [id, min, max, precision, roundTo, updateNodeParam])

  // ===== Track drag (Pointer Events, no HTML range input) =====
  const trackRef = useRef<HTMLDivElement>(null)

  // Drag-vs-commit split: during a drag we update the LOCAL slider value every
  // pointermove (smooth, zero kernel churn) and push the latest value into the
  // store on a requestAnimationFrame cadence (~1 per frame, ≈16ms) — NOT a fixed
  // 80ms timer. A frame-coalesced push means the value stream stays continuous
  // and tracks the finger instead of being diluted into a few sparse ticks; the
  // downstream exec coalescer (enqueueParamWrite) already drops stale in-flight
  // writes so the kernel only ever computes the newest value. On pointerup we
  // flush the final value once, so the kernel/persisted SSOT ends on the exact
  // value the user released at.
  const dragRafRef = useRef<{ raf: number | null; pending: number | null; last: number | null }>(
    { raf: null, pending: null, last: null },
  )

  // batteryNameRef: read the latest node name inside the pointerup closure
  // (avoid capturing the name variable from the initial render). Track both the
  // localized (zh) name and the English name so history label/labelEn never mix.
  const batteryNameRef = useRef(data.battery?.name ?? id)
  batteryNameRef.current = data.battery?.name ?? id
  const batteryNameEnRef = useRef(data.battery?.nameEn ?? (data.battery?.id ? formatIdAsLabel(data.battery.id) : id))
  batteryNameEnRef.current = data.battery?.nameEn ?? (data.battery?.id ? formatIdAsLabel(data.battery.id) : id)

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return
    e.preventDefault()
    e.stopPropagation()

    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: `修改参数：${batteryNameRef.current}`,
        labelEn: `Change parameter: ${batteryNameEnRef.current}`,
      })
    }

    const track = e.currentTarget
    const drag = dragRafRef.current

    // Push a value to the store coalesced to one write per animation frame: each
    // pointermove records the desired value; a single rAF flushes the latest one.
    // A burst of moves within a frame collapses to one store write (= one exec),
    // but consecutive frames each flush, so the stream is continuous (≈60/s cap)
    // rather than a fixed-interval throttle that drops it to a few sparse ticks.
    const flush = () => {
      drag.raf = null
      if (drag.pending === null) return
      const next = drag.pending
      drag.pending = null
      if (drag.last !== null && Object.is(drag.last, next)) return
      drag.last = next
      updateNodeParam(id, 'value', next)
    }
    const pushRaf = (clamped: number) => {
      drag.pending = clamped
      if (drag.raf === null) drag.raf = requestAnimationFrame(flush)
    }

    const update = (clientX: number) => {
      const rect = track.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const next = min + pct * (max - min)
      const clamped = Math.min(max, Math.max(min, roundTo(next, precision)))
      // Local value updates every frame → smooth slider with no kernel churn.
      setValue(clamped)
      pushRaf(clamped)
    }
    update(e.clientX)
    const onMove = (ev: PointerEvent) => {
      update(ev.clientX)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      // Cancel any pending rAF flush and commit the final value exactly once, so
      // the persisted/kernel SSOT lands on the value the user released at.
      if (drag.raf !== null) {
        cancelAnimationFrame(drag.raf)
        drag.raf = null
      }
      const finalVal = drag.pending ?? drag.last
      drag.pending = null
      drag.last = null
      if (finalVal !== null) updateNodeParam(id, 'value', finalVal)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [isEditing, min, max, precision, roundTo, updateNodeParam, id, value])

  // ===== Double-click to enter edit mode =====
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: `修改参数：${data.battery?.name ?? id}`,
        labelEn: `Change parameter: ${data.battery?.nameEn ?? (data.battery?.id ? formatIdAsLabel(data.battery.id) : id)}`,
      })
    }
    setEditText(String(value))
    setIsEditing(true)
  }, [value, id, data.battery?.nameEn, data.battery?.id])

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.select()
    }
  }, [isEditing])

  // Cancel any pending drag-rAF flush if the node unmounts mid-drag.
  useEffect(() => {
    const drag = dragRafRef.current
    return () => {
      if (drag.raf !== null) {
        cancelAnimationFrame(drag.raf)
        drag.raf = null
      }
    }
  }, [])

  const commitEdit = useCallback(() => {
    const parsed = parseFloat(editText)
    if (!isNaN(parsed)) {
      commit(parsed)
    }
    setIsEditing(false)
  }, [editText, commit])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') commitEdit()
    else if (e.key === 'Escape') setIsEditing(false)
  }, [commitEdit])

  // ===== Context menu =====
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMin(String(min))
    setCtxMax(String(max))
    setCtxPrecision(precision)
    setCtxMenuPos({ x: e.clientX, y: e.clientY })
    setShowCtxMenu(true)
  }, [min, max, precision])

  const applyCtxMenu = useCallback(() => {
    const newMin = parseFloat(ctxMin)
    const newMax = parseFloat(ctxMax)
    const validRange = !isNaN(newMin) && !isNaN(newMax) && newMin < newMax
    const ctxBatteryName = data.battery?.name ?? id
    const ctxBatteryNameEn = data.battery?.nameEn ?? (data.battery?.id ? formatIdAsLabel(data.battery.id) : id)
    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: `调整参数：${ctxBatteryName} 范围/精度`,
        labelEn: `Change parameter: ${ctxBatteryNameEn} range/precision`,
      })
    }
    if (validRange) {
      setMin(newMin)
      setMax(newMax)
      updateNodeParam(id, 'min', newMin)
      updateNodeParam(id, 'max', newMax)
      commit(value, ctxPrecision, newMin, newMax)
    } else {
      commit(value, ctxPrecision)
    }
    setPrecision(ctxPrecision)
    updateNodeParam(id, 'precision', ctxPrecision)
    setShowCtxMenu(false)
  }, [ctxMin, ctxMax, ctxPrecision, id, value, commit, updateNodeParam, data.battery])

  // Close the context menu on outside click.
  useEffect(() => {
    if (!showCtxMenu) return
    const onOutside = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setShowCtxMenu(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showCtxMenu])

  const fillPct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0
  const displayValue = precision === 0
    ? String(Math.round(value))
    : value.toFixed(precision)

  // Simplify the bound display (avoid overly long numbers).
  const fmtBound = (n: number) =>
    Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(3)).toString()

  const outputColor = getPortTypeColor('number')
  const isFavorite = favoriteBatteries.some(f => f.batteryId === data.battery.id)

  const handleFavoriteToggle = useCallback(() => {
    if (isFavorite) removeFavoriteBattery(data.battery.id)
    else addFavoriteBattery(data.battery)
    setShowCtxMenu(false)
  }, [isFavorite, data.battery, addFavoriteBattery, removeFavoriteBattery])

  // When wired, show the downstream port name (single link = port name, multi = port name xN).
  const downstreamLabel = useMemo(() => {
    const outEdges = edges.filter(e => e.source.nodeId === id)
    if (outEdges.length === 0) return null
    if (outEdges.length === 1) {
      const e = outEdges[0]
      const targetNode = pipeNodes.find(n => n.id === e.target.nodeId)
      if (!targetNode) return null
      const targetBattery = batteries.find(b => b.id === targetNode.batteryId)
      if (!targetBattery) return null
      const inputPort = targetBattery.inputs?.find(p => p.name === e.target.port)
      if (!inputPort) return null
      return langMode === 'zh' ? (inputPort.label || inputPort.name) : inputPort.name
    }
    // Multi-link: show a default name + xN to avoid ambiguity from a single port name.
    const defaultName = langMode === 'zh'
      ? (data.battery?.name || '数值')
      : (data.battery?.nameEn || formatIdAsLabel(data.battery?.id || 'number_const'))
    return `${defaultName} x${outEdges.length}`
  }, [edges, pipeNodes, batteries, id, langMode])

  const name = downstreamLabel ?? (langMode === 'zh'
    ? (data.battery?.name || '数值')
    : (data.battery?.nameEn || formatIdAsLabel(data.battery?.id || 'number_const')))

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.value
    const valueLine = outputVal !== undefined
      ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
      : { label: 'value:', text: formatPortValue(value), extra: formatPortValueExtra(value) }
    const out = data.battery.outputs[0]
    const portDesc = out ? (langMode === 'zh' ? out.description : (out.descriptionEn || out.description)) : undefined
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (out?.label ?? 'value') : (out?.name ?? 'value'),
      subtitle: 'Number', subtitleColor: outputColor,
      description: portDesc,
      valueLine,
    })
  }, [id, value, langMode, outputColor, data.battery, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh'
      ? data.battery.description
      : (data.battery.descriptionEn || data.battery.description)
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : (data.battery.nameEn || formatIdAsLabel(data.battery.id)),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type, data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  return (
    <div
      className={`ns-node${selected ? ' selected' : ''}`}
      onContextMenu={handleContextMenu}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* Left: name cell. */}
      <div className="ns-name-cell">
        <span className="ns-name">{name}</span>
      </div>

      {/* Right: slider area. */}
      <div className="ns-slider-cell">
        {/* Primary interaction: the track, or an input field. */}
        {isEditing ? (
          <input
            ref={editInputRef}
            className="ns-edit-input nodrag nowheel"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={commitEdit}
          />
        ) : (
          <div
            ref={trackRef}
            className="ns-track nodrag"
            onPointerDown={handleTrackPointerDown}
            onDoubleClick={handleDoubleClick}
          >
            {/* Fill region. */}
            <div className="ns-fill" style={{ width: `${fillPct}%` }} />
            {/* Drag grip (small vertical line, node-editor style). */}
            <div className="ns-grip" style={{ left: `${fillPct}%` }} />
            {/* Current value text. */}
            <span className="ns-val">{displayValue}</span>
          </div>
        )}

        {/* Min / max range annotations. */}
        <div className="ns-bounds">
          <span className="ns-bound">{fmtBound(min)}</span>
          <span className="ns-bound">{fmtBound(max)}</span>
        </div>
      </div>

      {/* Context menu: edit range + precision (portal to document.body so it is not
          occluded by other nodes). */}
      {showCtxMenu && ReactDOM.createPortal(
        <div
          ref={ctxMenuRef}
          className="ns-ctx-menu"
          style={{ left: ctxMenuPos.x, top: ctxMenuPos.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="ns-ctx-title">Slider Settings</div>

          <button type="button" className="ns-ctx-favorite" onClick={handleFavoriteToggle}>
            {isFavorite ? '⭐ Remove from Favorites' : '⭐ Add to Favorites'}
          </button>

          <div className="ns-ctx-row">
            <label className="ns-ctx-label">Min</label>
            <input
              className="ns-ctx-input"
              type="number"
              value={ctxMin}
              onChange={e => setCtxMin(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>

          <div className="ns-ctx-row">
            <label className="ns-ctx-label">Max</label>
            <input
              className="ns-ctx-input"
              type="number"
              value={ctxMax}
              onChange={e => setCtxMax(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
            />
          </div>

          <div className="ns-ctx-row">
            <label className="ns-ctx-label">Precision</label>
            <CustomSelect
              className="ns-select"
              value={ctxPrecision}
              onChange={v => setCtxPrecision(Number(v))}
              options={PRECISION_OPTIONS}
            />
          </div>

          <div className="ns-ctx-actions">
            <button className="ns-ctx-btn ns-ctx-btn--apply" onClick={applyCtxMenu}>Apply</button>
            <button className="ns-ctx-btn" onClick={() => setShowCtxMenu(false)}>Cancel</button>
          </div>
        </div>,
        document.body
      )}

      {/* Output port: events bound directly on the Handle to avoid a wrapper
          breaking ReactFlow positioning. */}
      <Handle
        type="source"
        position={Position.Right}
        id="value"
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
    </div>
  )
}

export default memo(NumberSliderNode)
