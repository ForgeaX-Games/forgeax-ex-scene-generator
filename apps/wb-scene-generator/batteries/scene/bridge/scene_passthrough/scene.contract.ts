// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "scenePassthrough",
  "contractVersion": "1.0.0",
  "opId": "scene_passthrough",
  "description": "Pass a scene through unchanged: the entire input DataTree is emitted as-is with no transform; branches/paths/focus/version are all preserved. Useful for wiring, fan-out, or as a pipeline placeholder/junction.",
  "agentVisible": false,
  "definitionScope": "group-body",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "tree",
      "required": true,
      "description": "Input scene; the entire DataTree is passed through unchanged.",
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
