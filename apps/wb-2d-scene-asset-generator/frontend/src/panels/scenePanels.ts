import type { NodeTypes } from '@xyflow/react'
import { BatteryNode } from '@forgeax/node-runtime-react/editor'
import ImageBatteryNode from '../workbench/ImageBatteryNode.js'
import ImagePreviewNode from '../workbench/ImagePreviewNode.js'
import ImageSourceNode from '../workbench/ImageSourceNode.js'

// Scene-domain node renderers, keyed by node `type`. Passed to <Editor> via the
// `domainNodeTypes` prop, which merges them per-render through
// `createCanvasNodeTypes` (no module-global registration).
//
// Ops without an entry here fall back to the kernel BatteryNode (inline param
// editing), the faithful default; entries are only needed for custom bodies.
//
// `scene_sink → BatteryNode` is a Stage 5 PLACEHOLDER: scene_sink currently has
// no custom renderer, so we map it to the default BatteryNode to make the
// domain-node-types wiring explicit. It is intentionally a no-op until the
// Stage 5 scene-sink body lands; do not build dual-registration machinery on it.
export const scenePanelTypes: Record<string, NodeTypes[string]> = {
  asset2d_image_battery: ImageBatteryNode,
  // image_preview is a pass-through inspector: it previews the UPSTREAM image
  // (read from the incoming edge) rather than its own output, so it gets a
  // dedicated renderer instead of the generic asset2d_image_battery one.
  image_preview: ImagePreviewNode,
  // image_source is an output-only image node created by dragging an image from
  // the All Images panel onto the canvas; it previews its OWN params.image.
  image_source: ImageSourceNode,
  scene_sink: BatteryNode,
}
