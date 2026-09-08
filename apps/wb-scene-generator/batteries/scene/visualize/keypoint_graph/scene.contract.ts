// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "keypointGraph",
  "contractVersion": "1.0.0",
  "opId": "keypoint_graph",
  "description": "Pass a keypoint dict (hierarchy tree + relation graph) through unchanged and render it below the node as an interactive force-directed graph: parent-child, clearance distance and orientation relations each use a distinct edge style, plus a click-to-highlight hierarchy list. Useful for inspecting keypoint structure and inter-node relations.",
  "inputs": [
    {
      "name": "keypoint",
      "type": "dict",
      "access": "item",
      "required": true,
      "description": "Input keypoint dict ({ hierarchy, relations }); passed through unchanged and rendered as a relation graph.",
      "label": "keypoint"
    }
  ],
  "outputs": [
    {
      "name": "keypoint",
      "type": "dict",
      "access": "item",
      "description": "The same keypoint dict as the input.",
      "label": "keypoint"
    }
  ],
  "deterministic": true
})
