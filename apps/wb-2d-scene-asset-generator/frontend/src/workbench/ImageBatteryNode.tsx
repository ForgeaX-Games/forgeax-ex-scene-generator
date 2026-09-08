import { memo } from 'react'
import {
  BatteryNode,
  usePipelineStore,
  isDataTreeEntries,
  type Battery,
  type NodeProps,
} from '@forgeax/node-runtime-react/editor'
import { pluginUrl } from '../api/pluginHttp'
import './ImageBatteryNode.css'

interface ImageBatteryNodeData {
  battery: Battery
  params: Record<string, unknown>
}

interface ImagePreviewItem {
  key: string
  portName: string
  src: string
}

function collectImageRefs(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (isDataTreeEntries(value)) {
    return value.flatMap((entry) => entry.items.flatMap((item) => collectImageRefs(item)))
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectImageRefs(item))
  return []
}

function imageRefToSrc(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('data:')) return trimmed
  if (!trimmed.startsWith('{')) return ''
  try {
    const parsed = JSON.parse(trimmed) as { blobId?: unknown }
    if (typeof parsed.blobId === 'string' && parsed.blobId) {
      return pluginUrl(`/api/v1/library/blob/${encodeURIComponent(parsed.blobId)}`)
    }
  } catch {
    return ''
  }
  return ''
}

function ImageBatteryNode(props: NodeProps<ImageBatteryNodeData>): JSX.Element {
  const { id, data } = props
  const nodeOutputData = usePipelineStore((s) => s.nodeOutputs[id])
  const imagePreviewItems: ImagePreviewItem[] = []

  if (nodeOutputData) {
    for (const port of data.battery.outputs ?? []) {
      if (port.hidden || port.type !== 'image') continue
      collectImageRefs(nodeOutputData[port.name]).forEach((ref, index) => {
        const src = imageRefToSrc(ref)
        if (!src) return
        imagePreviewItems.push({
          key: `${port.name}:${index}:${src}`,
          portName: port.name,
          src,
        })
      })
    }
  }

  return (
    <div className="asset2d-image-battery-node">
      <BatteryNode {...props} />
      {imagePreviewItems.length > 0 && (
        <div className="asset2d-image-preview nodrag">
          {imagePreviewItems.map((item) => (
            <figure className="asset2d-image-preview__item" key={item.key}>
              <img className="asset2d-image-preview__img" src={item.src} alt={`${item.portName} preview`} draggable={false} />
              <figcaption className="asset2d-image-preview__caption">{item.portName}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(ImageBatteryNode)
