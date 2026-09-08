// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneSetTransform",
  "contractVersion": "1.0.0",
  "opId": "scene_set_transform",
  "description": "Set local translation (relative to the parent) on a scene tree node. v1 supports translation only.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Scene port of the target node (focus must reference an existing node).",
      "label": "scene"
    },
    {
      "name": "translation",
      "type": "point3d",
      "access": "item",
      "description": "Local translation vector (relative to parent).",
      "label": "translation"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "Updated scene port (focus unchanged).",
      "label": "scene"
    }
  ],
  "deterministic": true
})
