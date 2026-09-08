// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneSetAttribute",
  "contractVersion": "1.0.0",
  "opId": "scene_set_attribute",
  "description": "Set a custom attribute (key, value) on the focused scene node. Same key overwrites; other keys are preserved. Attributes follow the node through subsequent transforms, grafting, and cell rewrites.",
  "agentVisible": false,
  "definitionScope": "group-body",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Scene port of the target node (focus points at the node to write).",
      "label": "scene"
    },
    {
      "name": "key",
      "type": "string",
      "access": "item",
      "required": true,
      "description": "Attribute key (non-empty string).",
      "label": "key",
      "mode": "parameter"
    },
    {
      "name": "value",
      "type": "any",
      "access": "item",
      "required": true,
      "description": "Attribute value (any type). Each call writes one value (access:item fans out per item); to store a list as a single value, wrap it once more (e.g. [[1,2,3]]).",
      "label": "value"
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
