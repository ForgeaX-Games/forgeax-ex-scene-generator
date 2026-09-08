// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneMergeSubtrees",
  "contractVersion": "1.0.0",
  "opId": "scene_merge_subtrees",
  "description": "Merge multiple scenes (each with a subtree expanded under its own focus) into one master scene. Algorithm: take the first scene as base, then graft each scene's focus children one by one in order (each assigned an increasing version to preserve z-order); when multiple scenes merge under the same focus their children are concatenated, and duplicate-named children keep the first arrival; output focus is fixed to the root \"/\". The convergence step of each fanout level in the recursive expansion protocol.",
  "inputs": [
    {
      "name": "scenes",
      "type": "scene",
      "access": "list",
      "required": true,
      "description": "List of scenes; each has its focus subtree independently expanded by its branch.",
      "label": "scene 列表"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "Master scene containing every branch's expanded subtree; focus = root \"/\".",
      "label": "合并后 scene"
    },
    {
      "name": "mergedCount",
      "type": "number",
      "access": "item",
      "description": "Number of scenes that actually contributed to the merge (scenes with focus='/' or a missing focus node are not counted).",
      "label": "合并数量"
    }
  ],
  "deterministic": true
})
