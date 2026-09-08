// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneGetAttribute",
  "contractVersion": "1.0.0",
  "opId": "scene_get_attribute",
  "description": "Read a custom attribute value from the focused scene node. Returns exists=false with value=null when the node or key is absent.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Scene port of the target node (focus points at the node to read).",
      "label": "scene"
    },
    {
      "name": "key",
      "type": "string",
      "access": "item",
      "required": true,
      "description": "Attribute key.",
      "label": "key",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "any",
      "access": "item",
      "description": "Attribute value; null when absent.",
      "label": "value"
    },
    {
      "name": "exists",
      "type": "bool",
      "access": "item",
      "description": "Node exists and key is present.",
      "label": "exists"
    }
  ],
  "deterministic": true
})
