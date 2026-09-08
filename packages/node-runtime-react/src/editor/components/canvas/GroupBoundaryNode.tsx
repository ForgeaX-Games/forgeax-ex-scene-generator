// Group boundary "shell" node: represents a group's edited exposed ports inside
// the group view, and bridges each external up/downstream wire to the real inner
// port. The shell is editable just like the collapsed group face — ports can be
// renamed, reordered, retyped (right-click), hidden, deleted, and new ones
// created — and every edit is
// written straight to the group (so the outer instance auto-derives `unsaved*`).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import type { NodeProps } from '../../xyflow.js'
import { getPortTypeColor, normalizeType, resolveCanonicalTypeMeta, type DomainPortTypes } from '../../utils/portTypes.js'
import type { ExposedPort } from '../../types.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getGroupPortDisplayLabel, getVisibleGroupPorts, sortGroupPorts, resolveGroupExposedInputValue } from './groupViewUtils.js'
import { TooltipPortal, useNodeTooltip, useNodeValueFormatters } from './nodeTooltip.js'
import './GroupBoundaryNode.css'

/** Floating port-type picker: lists the core + domain types, mounted to body. */
function PortTypeMenu({
  x,
  y,
  currentType,
  en,
  domainPortTypes,
  onPick,
  onClose,
}: {
  x: number
  y: number
  currentType: string
  en: boolean
  domainPortTypes?: DomainPortTypes
  onPick: (type: string) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const types = useMemo(() => resolveCanonicalTypeMeta(domainPortTypes), [domainPortTypes])
  const canonicalCurrent = normalizeType(currentType)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="group-boundary-type-menu nodrag"
      style={{ top: y, left: x }}
      role="listbox"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="group-boundary-type-menu__title">{en ? 'Port type' : '端口类型'}</div>
      {types.map((t) => {
        const active = normalizeType(t.type) === canonicalCurrent
        return (
          <div
            key={t.type}
            className={`group-boundary-type-menu__item${active ? ' group-boundary-type-menu__item--active' : ''}`}
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onPick(t.type)
            }}
          >
            <span className="group-boundary-type-menu__dot" style={{ background: getPortTypeColor(t.type, domainPortTypes) }} />
            <span className="group-boundary-type-menu__name">{en ? t.descEn : t.desc}</span>
            <span className="group-boundary-type-menu__code">{t.type}</span>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

export interface GroupBoundaryNodeData {
  /** 'input' = the group's input-boundary node (provides source Handles for inner nodes to connect into)
   *  'output' = the group's output-boundary node (receives target Handles from inner nodes connecting out)
   */
  boundaryType: 'input' | 'output'
  groupId: string
  ports: ExposedPort[]
  /** Display label; defaults to "Group input" / "Group output". */
  label?: string
  /** Whether the shell is editable (false for template groups). Defaults to true. */
  editable?: boolean
  /** Rebuild the inner view after a structural port change (add/remove/hide/reorder). */
  onRebuild?: () => void
}

const GroupBoundaryNode = memo(function GroupBoundaryNode({
  id,
  data,
  domainPortTypes,
}: NodeProps<GroupBoundaryNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const { boundaryType, groupId, ports: fallbackPorts, label, editable = true, onRebuild } = data
  const isInput = boundaryType === 'input'
  const direction = isInput ? 'input' : 'output'
  const en = useUIStore(s => s.langMode === 'en')
  const displayLabel = label ?? (isInput ? (en ? 'Group input' : '组输入') : (en ? 'Group output' : '组输出'))
  const updateNodeInternals = useUpdateNodeInternals()

  const updateGroupPort = usePipelineStore(s => s.updateGroupPort)
  const moveGroupPort = usePipelineStore(s => s.moveGroupPort)
  const addGroupExposedPort = usePipelineStore(s => s.addGroupExposedPort)
  const removeGroupExposedPort = usePipelineStore(s => s.removeGroupExposedPort)

  const currentGroup = usePipelineStore(
    useCallback((s) => (s.currentPipeline?.groups ?? []).find(g => g.id === groupId), [groupId])
  )
  // Externally-connected ports cannot be hidden/deleted without dangling the
  // outer wire; mirror the collapsed group node's guard. Subscribe to the stable
  // edges/nodes arrays and derive the Set in a memo (avoid a fresh-Set selector
  // that would re-render on every unrelated store change).
  const pipelineEdges = usePipelineStore(s => s.currentPipeline?.edges ?? [])
  const pipelineNodes = usePipelineStore(s => s.currentPipeline?.nodes ?? [])
  const connectedPorts = useMemo(() => {
    const shadowIds = new Set(
      pipelineNodes
        .filter(n => n.batteryId === '__group__' && n.params?.groupId === groupId)
        .map(n => n.id),
    )
    const names = new Set<string>()
    for (const e of pipelineEdges) {
      if (direction === 'input' && shadowIds.has(e.target.nodeId)) names.add(e.target.port)
      if (direction === 'output' && shadowIds.has(e.source.nodeId)) names.add(e.source.port)
    }
    return names
  }, [pipelineEdges, pipelineNodes, groupId, direction])

  const ports = useMemo(() => {
    const fallbackByName = new Map(fallbackPorts.map(port => [port.portName, port]))
    const sourcePorts = currentGroup ? getVisibleGroupPorts(
      isInput ? currentGroup.exposedInputs : currentGroup.exposedOutputs
    ) : getVisibleGroupPorts(fallbackPorts)
    return sourcePorts.map(port => {
      const fallback = fallbackByName.get(port.portName)
      return fallback && port.portType === 'any' ? { ...port, portType: fallback.portType } : port
    })
  }, [isInput, currentGroup, fallbackPorts])

  // Port value tooltip. The inner view's run-time aliasing writes each shell
  // port's live value into nodeOutputs under this shell node's id (external input
  // on the input shell, the group's exposed output on the output shell), so the
  // shell can faithfully show the data flowing through each exposed port.
  const { tooltip, showImmediate, hide } = useNodeTooltip(1000, 400)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()
  const showPortValueTooltip = useCallback((e: React.MouseEvent, port: ExposedPort) => {
    const val = usePipelineStore.getState().nodeOutputs[id]?.[port.portName]
    const canonical = normalizeType(port.portType)
    // Unconnected input shell: fall back to the inner source port's default so
    // the shell shows the same default the inner port carries (not "no value").
    const fallback = val === undefined && isInput && currentGroup
      ? resolveGroupExposedInputValue(currentGroup, port)
      : undefined
    const shown = val !== undefined ? val : fallback?.value
    const label = fallback?.isDefault ? 'default:' : (isInput ? 'input:' : 'output:')
    const valueLine = shown !== undefined
      ? { label, text: formatPortValue(shown), extra: formatPortValueExtra(shown), muted: fallback?.isDefault === true }
      : { label, text: en ? 'no value' : '暂无数据', muted: true as const }
    showImmediate({
      x: e.clientX + 16,
      y: e.clientY - 8,
      title: getGroupPortDisplayLabel(port, en),
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1),
      subtitleColor: getPortTypeColor(port.portType, domainPortTypes),
      valueLine,
    })
  }, [id, isInput, en, currentGroup, showImmediate, formatPortValue, formatPortValueExtra, domainPortTypes])

  const [editingPort, setEditingPort] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [typeMenu, setTypeMenu] = useState<{ portName: string; portType: string; x: number; y: number } | null>(null)
  const draggingRef = useRef<string | null>(null)
  const dragOverRef = useRef<string | null>(null)

  const refreshHandles = useCallback(() => {
    requestAnimationFrame(() => updateNodeInternals(id))
  }, [id, updateNodeInternals])

  const startRename = useCallback((port: ExposedPort) => {
    setEditingPort(port.portName)
    setLabelDraft(getGroupPortDisplayLabel(port, en))
  }, [en])

  const commitRename = useCallback((port: ExposedPort) => {
    const trimmed = labelDraft.trim()
    updateGroupPort(groupId, direction, port.portName, {
      [en ? 'customLabelEn' : 'customLabel']: trimmed || undefined,
    })
    setEditingPort(null)
  }, [labelDraft, updateGroupPort, groupId, direction, en])

  const openTypeMenu = useCallback((e: React.MouseEvent, port: ExposedPort) => {
    e.preventDefault()
    e.stopPropagation()
    setTypeMenu({ portName: port.portName, portType: port.portType, x: e.clientX, y: e.clientY })
  }, [])

  const pickPortType = useCallback((portType: string) => {
    if (!typeMenu) return
    const result = updateGroupPort(groupId, direction, typeMenu.portName, { portType })
    setTypeMenu(null)
    if (result.ok) {
      refreshHandles()
      onRebuild?.()
    }
  }, [typeMenu, updateGroupPort, groupId, direction, refreshHandles, onRebuild])

  const handleHide = useCallback((port: ExposedPort) => {
    const result = updateGroupPort(groupId, direction, port.portName, { hidden: true })
    if (result.ok) onRebuild?.()
  }, [updateGroupPort, groupId, direction, onRebuild])

  const handleDelete = useCallback((port: ExposedPort) => {
    const result = removeGroupExposedPort(groupId, direction, port.portName)
    if (result.ok) onRebuild?.()
  }, [removeGroupExposedPort, groupId, direction, onRebuild])

  const handleAdd = useCallback(() => {
    const result = addGroupExposedPort(groupId, direction)
    if (result.ok) {
      onRebuild?.()
      refreshHandles()
    }
  }, [addGroupExposedPort, groupId, direction, onRebuild, refreshHandles])

  const commitReorder = useCallback((targetPortName: string) => {
    const dragged = draggingRef.current
    if (!dragged || dragged === targetPortName) return
    const ordered = sortGroupPorts(
      (isInput ? currentGroup?.exposedInputs : currentGroup?.exposedOutputs) ?? ports,
    )
    const from = ordered.findIndex(p => p.portName === dragged)
    const to = ordered.findIndex(p => p.portName === targetPortName)
    if (from < 0 || to < 0) return
    const step: -1 | 1 = from < to ? 1 : -1
    for (let i = from; i !== to; i += step) moveGroupPort(groupId, direction, dragged, step)
    draggingRef.current = null
    dragOverRef.current = null
    onRebuild?.()
  }, [currentGroup, isInput, ports, moveGroupPort, groupId, direction, onRebuild])

  const finishDrag = useCallback(() => {
    const target = dragOverRef.current
    if (target) commitReorder(target)
    draggingRef.current = null
    dragOverRef.current = null
  }, [commitReorder])

  return (
    <div className={`group-boundary-node group-boundary-node--${boundaryType} nodrag nopan`}>
      <div className="group-boundary-node__header" onMouseDown={(e) => e.stopPropagation()}>
        <span className="group-boundary-node__icon">{isInput ? 'IN' : 'OUT'}</span>
        <span className="group-boundary-node__label">{displayLabel}</span>
        <span className="group-boundary-node__count">{ports.length}</span>
        {editable && (
          <button
            type="button"
            className="group-boundary-node__add nodrag"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleAdd}
            title={en ? 'Add port' : '新建端口'}
          >
            +
          </button>
        )}
      </div>

      <div className="group-boundary-node__ports">
        {ports.map(port => {
          const color = getPortTypeColor(port.portType, domainPortTypes)
          const portDisplayLabel = getGroupPortDisplayLabel(port, en)
          const isConnected = connectedPorts.has(port.portName)
          const isEditing = editingPort === port.portName
          return (
            <div
              key={port.portName}
              className={`group-boundary-node__port nodrag`}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => showPortValueTooltip(e, port)}
              onMouseLeave={hide}
              onContextMenu={editable ? (e) => openTypeMenu(e, port) : undefined}
              onDragOver={editable ? (e) => {
                if (draggingRef.current) { dragOverRef.current = port.portName; e.preventDefault() }
              } : undefined}
              onDrop={editable ? (e) => { e.preventDefault(); e.stopPropagation(); commitReorder(port.portName) } : undefined}
            >
              {/* Target handle (left): input shell receives the external upstream; output shell receives the inner output. */}
              <Handle
                type="target"
                position={Position.Left}
                id={port.portName}
                style={{ background: color, border: `2px solid ${color}` }}
              />

              {isEditing ? (
                <input
                  className="group-boundary-node__port-input nodrag"
                  value={labelDraft}
                  autoFocus
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => commitRename(port)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename(port)
                    if (e.key === 'Escape') setEditingPort(null)
                  }}
                />
              ) : (
                <span
                  className="group-boundary-node__port-label"
                  style={{ color }}
                  title={editable ? (en ? 'Double-click rename, drag reorder, right-click set type' : '双击重命名，拖动排序，右击设置类型') : port.portName}
                  draggable={editable}
                  onDragStart={editable ? (e) => {
                    e.stopPropagation()
                    draggingRef.current = port.portName
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', port.portName)
                  } : undefined}
                  onDragEnd={editable ? finishDrag : undefined}
                  onDoubleClick={editable ? (e) => { e.stopPropagation(); startRename(port) } : undefined}
                >
                  {portDisplayLabel}
                </span>
              )}

              {editable && (
                <span className="group-boundary-node__port-actions nodrag">
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={isConnected}
                    onClick={() => handleHide(port)}
                    title={isConnected
                      ? (en ? 'Disconnect external wire before hiding' : '请先断开外部连线再隐藏')
                      : (en ? 'Hide port' : '隐藏端口')}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={isConnected}
                    onClick={() => handleDelete(port)}
                    title={isConnected
                      ? (en ? 'Disconnect external wire before deleting' : '请先断开外部连线再删除')
                      : (en ? 'Delete port' : '删除端口')}
                  >
                    ×
                  </button>
                </span>
              )}

              {/* Source handle (right) — input shell exits to the inner port; output shell exits to the external downstream. */}
              <Handle
                type="source"
                position={Position.Right}
                id={port.portName}
                style={{ background: color, border: `2px solid ${color}` }}
              />
            </div>
          )
        })}
      </div>

      {typeMenu && (
        <PortTypeMenu
          x={typeMenu.x}
          y={typeMenu.y}
          currentType={typeMenu.portType}
          en={en}
          domainPortTypes={domainPortTypes}
          onPick={pickPortType}
          onClose={() => setTypeMenu(null)}
        />
      )}

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
})

export default GroupBoundaryNode
