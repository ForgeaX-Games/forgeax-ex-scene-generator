// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneFocusChildren",
  "contractVersion": "1.0.0",
  "opId": "scene_focus_children",
  "description": "Expand a scene into a list of scenes, each focused on a child of the current focus. Trees are shared (no copy), only focus differs. The drill-down primitive of the recursive expansion protocol—downstream expander batteries process each child independently via DataTree fanout.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Scene to expand; focus must point at an existing node.",
      "label": "scene"
    }
  ],
  "outputs": [
    {
      "name": "scenes",
      "type": "scene",
      "access": "list",
      "description": "One scene per immediate child, with focus on that child; empty list when there are no children.",
      "label": "子 scene 列表"
    },
    {
      "name": "childCount",
      "type": "number",
      "access": "item",
      "description": "Number of immediate children under focus.",
      "label": "子节点数"
    }
  ],
  "deterministic": true
})
