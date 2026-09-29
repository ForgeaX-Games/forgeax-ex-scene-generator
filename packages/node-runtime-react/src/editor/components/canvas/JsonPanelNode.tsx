import { memo, useCallback } from 'react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import type { NodeProps } from '../../xyflow.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { PortJsonEditor } from './PortJsonEditor.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './JsonPanelNode.css'

interface JsonPanelNodeData {
  battery: {
    id: string
    name: string
    type?: string
    nameEn?: string
    version?: string
    category?: string
    description?: string
    descriptionEn?: string
    outputs: Array<{ name: string; type: string; label?: string }>
  }
  params: Record<string, unknown>
}

function JsonPanelNode({ id, data, selected, dragging }: NodeProps<JsonPanelNodeData>) {
  const { battery, params } = data
  const langMode = useUIStore((s) => s.langMode)
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()
  const outputColor = getPortTypeColor('dict')
  const value = params.value !== undefined ? params.value : {}

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const outputVal = usePipelineStore.getState().nodeOutputs[id]?.value ?? value
    showImmediate({
      x: e.clientX + 16,
      y: e.clientY - 8,
      title: langMode === 'zh' ? '字典' : 'dict',
      subtitle: 'Dict',
      subtitleColor: outputColor,
      valueLine: {
        label: 'value:',
        text: formatPortValue(outputVal),
        extra: formatPortValueExtra(outputVal),
      },
    })
  }, [id, langMode, outputColor, showImmediate, formatPortValue, formatPortValueExtra, value])

  const showBatteryTooltip = useCallback(() => {
    showDelayed({
      title: langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id),
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type ?? 'json_panel', battery.category ?? 'Basic/input'),
      tagLineColor: getBatteryTypeColor(battery.type ?? 'json_panel'),
      description: langMode === 'zh' ? battery.description : (battery.descriptionEn || battery.description),
    } satisfies BatteryTooltipState)
  }, [battery, langMode, showDelayed])

  return (
    <div
      className={`json-panel-node ${selected ? 'selected' : ''}`}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      <NodeResizer
        minWidth={180}
        minHeight={120}
        isVisible={selected}
        lineClassName="json-panel-resize-line"
        handleClassName="json-panel-resize-handle"
        onResizeEnd={(_event, size) => {
          updateNodeParam(id, '_nodeWidth', size.width, true)
          updateNodeParam(id, '_nodeHeight', size.height, true)
          schedulePersistSession('json-panel-resize')
        }}
      />
      <div className="json-panel-header">
        <span className="json-panel-title">
          {langMode === 'zh' ? battery.name : battery.nameEn || formatIdAsLabel(battery.id)}
        </span>
        <span className="json-panel-badge">JSON</span>
      </div>
      <PortJsonEditor
        value={value}
        zh={langMode === 'zh'}
        onCommit={(next) => updateNodeParam(id, 'value', next)}
      />
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

export default memo(JsonPanelNode)
