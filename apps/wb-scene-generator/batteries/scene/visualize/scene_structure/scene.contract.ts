// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneStructure",
  "contractVersion": "1.0.0",
  "opId": "scene_structure",
  "description": "Pass scene through unchanged and show an expandable tree of the full logical hierarchy below the node, including per-node voxel counts. Useful for debugging scene structure and focus context.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "tree",
      "required": true,
      "description": "Input scene; the entire DataTree is passed through unchanged and rendered as a structure tree.",
      "label": "scene"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "tree",
      "description": "The same scene as the input (identical DataTree, zero transform).",
      "label": "scene"
    }
  ],
  "deterministic": true
})
