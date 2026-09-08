import type { NodeTypes } from '@xyflow/react'
import { BatteryNode } from '@forgeax/node-runtime-react/editor'
import KeypointGraphNode from '../workbench/KeypointGraphNode.js'
import MaskStructureNode from '../workbench/MaskStructureNode.js'
import SceneStructureNode from '../workbench/SceneStructureNode.js'

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
  scene_structure: SceneStructureNode,
  mask_structure: MaskStructureNode,
  keypoint_graph: KeypointGraphNode,
  scene_sink: BatteryNode,
}
