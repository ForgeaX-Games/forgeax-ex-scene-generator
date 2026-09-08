import { memo } from 'react'
import {
  BatteryNode,
  usePipelineStore,
  isDataTreeEntries,
  type Battery,
  type NodeProps,
} from '@forgeax/node-runtime-react/editor'
import { pluginUrl } from '../api/pluginHttp'
import './ImagePreviewNode.css'

interface ImagePreviewNodeData {
  battery: Battery
  params: Record<string, unknown>
}

// Collect every usable image ref out of a (possibly DataTree-wrapped) value,
// preserving order so a multi-image input renders one thumbnail per image.
function collectImageRefs(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (isDataTreeEntries(value)) {
    return value.flatMap((entry) => entry.items.flatMap((item) => collectImageRefs(item)))
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectImageRefs(item))
  return []
}

// Resolve an encoded image ref (alias / data URL / { blobId }) to a browser src.
// Matches ImageBatteryNode: blobId → the app's content-addressed blob route.
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

function ImagePreviewNode(props: NodeProps<ImagePreviewNodeData>): JSX.Element {
  const { id } = props

  // Read the upstream image straight from the edge feeding our `image` input,
  // so the preview shows even before this node has produced its own output
  // (it is a pure pass-through probe).
  const edges = usePipelineStore((s) => s.currentPipeline?.edges ?? [])
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs)

  const edge = edges.find((e) => e.target.nodeId === id && e.target.port === 'image')
  const upstream = edge ? nodeOutputs[edge.source.nodeId]?.[edge.source.port] : undefined
  const srcs = collectImageRefs(upstream)
    .map((ref) => imageRefToSrc(ref))
    .filter((src) => src.length > 0)
  const hasImage = srcs.length > 0
  const isMulti = srcs.length > 1

  return (
    <div className="asset2d-image-preview-node">
      <BatteryNode {...props} />
      <div className={`ip-preview nodrag${hasImage ? ' has-image' : ''}${isMulti ? ' is-multi' : ''}`}>
        {hasImage ? (
          isMulti ? (
            <div className="ip-preview__grid">
              {srcs.map((src, index) => (
                <figure className="ip-preview__item" key={`${index}:${src}`}>
                  <img className="ip-preview__img" src={src} alt={`image preview ${index + 1}`} draggable={false} />
                  <figcaption className="ip-preview__caption">{index + 1}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <img className="ip-preview__img" src={srcs[0]} alt="image preview" draggable={false} />
          )
        ) : (
          <div className="ip-preview__placeholder">
            <svg className="ip-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="ip-preview__hint">连接图像端口</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ImagePreviewNode)
