// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneFocusPath",
  "contractVersion": "1.0.0",
  "opId": "scene_focus_path",
  "description": "Explicit refocus: keep the tree, change focus to the given path. Useful for manual targeting or resetting focus to a common ancestor after multi-level fanout.",
  "agentVisible": false,
  "definitionScope": "group-body",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Input scene (any focus).",
      "label": "scene"
    },
    {
      "name": "path",
      "type": "string",
      "access": "item",
      "required": true,
      "description": "Target absolute path (must exist in tree; '/' means root).",
      "label": "路径",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "Scene with focus set to path.",
      "label": "scene"
    }
  ],
  "deterministic": true
})
