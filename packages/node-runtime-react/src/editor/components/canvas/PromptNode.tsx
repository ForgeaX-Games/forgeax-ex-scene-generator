// PromptNode — renderer for a saved-prompt node. Styled exactly like a normal
// BatteryNode (reuses BatteryNode.css), but its ports are derived from the
// node's OWN params (template + _promptVars), NOT the catalog battery — so a
// reloaded prompt node (whose catalog battery is the bare shared `prompt_template`
// op with no var ports) still renders its full port set. Each `[xxx]` placeholder
// becomes a `str` input port named `xxx`; the single output is `prompt`.
//
// Right-click opens a read-only detail panel showing the full template text
// (the saved prompt's English content), modelled on the TextPanel save modal.
import { memo, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '../../xyflow.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getPortTypeColor, normalizeType, type DomainPortTypes } from '../../utils/portTypes.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import {
  TooltipPortal,
  useNodeTooltip,
  resolveInputPortValue,
  useNodeValueFormatters,
} from './nodeTooltip.js'
import { ContextMenuPortal, type ContextMenuState } from './BatteryNode.js'
import './BatteryNode.css'
import './TextPanelNode.css'

interface PromptNodeData {
  battery: {
    id: string
    name: string
    nameEn?: string
    iconSvg?: string
  }
  params: Record<string, unknown>
}

function readVars(params: Record<string, unknown>): string[] {
  const raw = params._promptVars
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
  // Fallback: re-derive from the template (older nodes / hand-edited graphs).
  const template = typeof params.template === 'string' ? params.template : ''
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\[([^[\]]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const name = m[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

function PromptNode({ id, data, selected, dragging }: NodeProps<PromptNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const { params } = data
  const langMode = useUIStore((s) => s.langMode)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  const vars = readVars(params)
  const template = typeof params.template === 'string' ? params.template : ''
  const promptName =
    (typeof params._promptName === 'string' && params._promptName) ||
    data.battery?.name ||
    formatIdAsLabel(data.battery?.id || 'prompt')

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const inputColor = getPortTypeColor('string')
  const outputColor = getPortTypeColor('string')

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeIds: [id],
        previewEnabled: true,
        hidePreview: true,
        extraItems: [
          {
            label: langMode === 'zh' ? '显示详细内容' : 'Show details',
            onClick: () => setShowDetail(true),
          },
        ],
      })
      hide()
    },
    [id, langMode, hide],
  )

  const showInputPortTooltip = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, name: string) => {
      const canonical = normalizeType('string')
      const inputVal = resolveInputPortValue(id, name)
      const valueLine =
        inputVal !== undefined
          ? { label: 'value:', text: formatPortValue(inputVal), extra: formatPortValueExtra(inputVal) }
          : undefined
      showImmediate({
        x: e.clientX + 16,
        y: e.clientY - 8,
        title: name,
        subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1),
        subtitleColor: getPortTypeColor(canonical),
        valueLine,
      })
    },
    [id, showImmediate, formatPortValue, formatPortValueExtra],
  )

  const showOutputPortTooltip = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const outputVal = usePipelineStore.getState().nodeOutputs[id]?.prompt
      const valueLine =
        outputVal !== undefined
          ? { label: 'output:', text: formatPortValue(outputVal), extra: formatPortValueExtra(outputVal) }
          : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true as const }
      showImmediate({
        x: e.clientX + 16,
        y: e.clientY - 8,
        title: 'prompt',
        subtitle: 'String',
        subtitleColor: getPortTypeColor('string'),
        valueLine,
      })
    },
    [id, langMode, showImmediate, formatPortValue, formatPortValueExtra],
  )

  const showBatteryTooltip = useCallback(() => {
    showDelayed({
      title: promptName,
      icon: data.battery?.iconSvg,
      tagLine: 'Prompt',
      description: template,
    })
  }, [promptName, data.battery?.iconSvg, template, showDelayed])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  return (
    <div
      className={`battery-node ${selected ? 'selected' : ''}`}
      data-battery-type="special"
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      <div className="node-header">
        <span className="node-title">{promptName}</span>
      </div>

      <div className="node-ports">
        <div className="input-ports">
          {vars.map((name) => (
            <div key={name} className="port input-port">
              <Handle
                type="target"
                position={Position.Left}
                id={name}
                style={{ background: inputColor, border: `2px solid ${inputColor}`, width: 10, height: 10 }}
                onMouseEnter={(e) => showInputPortTooltip(e, name)}
                onMouseLeave={hide}
              />
              <span className="port-label">{name}</span>
            </div>
          ))}
        </div>

        <div className="output-ports">
          <div className="port output-port">
            <span className="port-label">prompt</span>
            <Handle
              type="source"
              position={Position.Right}
              id="prompt"
              style={{ background: outputColor, border: `2px solid ${outputColor}`, width: 10, height: 10 }}
              onMouseEnter={showOutputPortTooltip}
              onMouseLeave={hide}
            />
          </div>
        </div>
      </div>

      {tooltip && <TooltipPortal tooltip={tooltip} />}
      {contextMenu && (
        <ContextMenuPortal menu={contextMenu} onClose={closeContextMenu} onAction={() => {}} />
      )}

      {/* Read-only detail panel: shows the full template text. Modelled on the
          TextPanel save modal (centered, blurred backdrop), but no inputs. */}
      {showDetail &&
        createPortal(
          <div
            className="tp-save-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowDetail(false)
            }}
          >
            <div className="tp-save-modal nodrag nowheel">
              <div className="tp-save-header">
                <span className="tp-save-title">{promptName}</span>
                <button
                  type="button"
                  className="tp-save-close"
                  onClick={() => setShowDetail(false)}
                  aria-label={langMode === 'zh' ? '关闭' : 'Close'}
                >
                  ✕
                </button>
              </div>
              <div className="tp-save-body">
                <pre className="prompt-detail-text">{template}</pre>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

export default memo(PromptNode)
