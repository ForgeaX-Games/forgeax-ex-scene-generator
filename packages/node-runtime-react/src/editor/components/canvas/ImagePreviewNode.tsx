// Image preview node: takes an encoded ImageRef from the upstream `image` port,
// resolves it to a content-addressed URL for display, and passes it through to
// the downstream output. Layout: left input port | center preview (auto-fit) |
// right output port; matches the ImageReaderNode style. Ported from the legacy
// editor (components/canvas/ImagePreviewNode.tsx).
import { memo, useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '../../xyflow.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { TooltipPortal, useNodeTooltip, type BatteryTooltipState } from './nodeTooltip.js'
import { getRealNodeIdFromContext } from './groupBoundaryIds.js'
import type { Battery } from '../../types.js'
import { imageRefToSrc } from '../../utils/imageRef.js'
import { isDataTreeEntries } from '../../utils/datatreeShape.js'
import './ImagePreviewNode.css'

interface ImagePreviewNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function firstImageRef(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (isDataTreeEntries(value)) {
    for (const entry of value) {
      for (const item of entry.items) {
        if (typeof item === 'string' && item.trim()) return item.trim()
      }
    }
  }
  return ''
}

function ImagePreviewNode({ id, data, selected, dragging }: NodeProps<ImagePreviewNodeData>) {
  const { battery } = data

  const upstreamImage = usePipelineStore(
    useCallback((s) => {
      const lookupId = getRealNodeIdFromContext(id)
      const edge = (s.currentPipeline?.edges ?? []).find(
        (e) => e.target.nodeId === lookupId && e.target.port === 'image',
      )
      if (!edge) return ''
      const upstream = s.nodeOutputs[edge.source.nodeId]?.[edge.source.port]
      return firstImageRef(upstream)
    }, [id]),
  )

  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'

  const { tooltip, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)

  const imageColor = getPortTypeColor('image')

  const previewSrc = imageRefToSrc(upstreamImage)
  const hasImage = previewSrc.length > 0

  const displayName = langMode === 'zh'
    ? (battery?.name || '图像预览')
    : formatIdAsLabel(battery?.id || 'image_preview')

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh'
      ? battery.description
      : (battery.descriptionEn || battery.description)
    showDelayed({
      title: langMode === 'zh' ? battery.name : formatIdAsLabel(battery.id),
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type, battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [battery, langMode, showDelayed])

  return (
    <div
      className={`ip-node${selected ? ' selected' : ''}`}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* Left: input port + name cell (drag region). */}
      <div className="ip-name-cell">
        <Handle
          type="target"
          position={Position.Left}
          id="image"
          style={{
            background: imageColor,
            border: `2px solid ${imageColor}`,
            width: 10,
            height: 10,
          }}
        />
        <span className="ip-name">{displayName}</span>
      </div>

      {/* Center: preview area (display only, not editable). */}
      <div className={`ip-preview-cell nodrag${hasImage ? ' has-image' : ''}`}>
        {hasImage ? (
          <img
            className="ip-preview-img"
            src={previewSrc}
            alt="preview"
            draggable={false}
          />
        ) : (
          <div className="ip-placeholder">
            <svg className="ip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="ip-hint">
              {en ? 'Connect image' : '连接图像端口'}
            </span>
          </div>
        )}
      </div>

      {/* Right: output port (pass-through). */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{
          background: imageColor,
          border: `2px solid ${imageColor}`,
          width: 10,
          height: 10,
        }}
      />

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
}

export default memo(ImagePreviewNode)
