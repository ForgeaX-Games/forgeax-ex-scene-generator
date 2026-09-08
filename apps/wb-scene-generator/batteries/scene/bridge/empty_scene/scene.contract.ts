// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "emptyScene",
  "contractVersion": "1.0.0",
  "opId": "empty_scene",
  "description": "No inputs; emits an empty scene: a scene DataTree containing only one empty root node (no children). Useful as a pipeline source, placeholder, or a root to graft child nodes onto.",
  "inputs": [],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "tree",
      "description": "Empty scene: a DataTree with a single empty root node (no children), focus on root '/'.",
      "label": "scene"
    }
  ],
  "deterministic": true
})
