// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "sceneOutput",
  "contractVersion": "1.0.0",
  "opId": "scene_output",
  "description": "Sync a scene to the renderer: flatten the focus subtree into a list of voxel layers (one layer per node with cells). Sink form — output handles hidden in UI, but NODE_OUTPUT still emits and the renderer's voxel-layer bucket consumes it.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "required": true,
      "description": "Scene to sync to the renderer; each cell-bearing node under focus becomes one voxel layer.",
      "label": "scene"
    }
  ],
  "outputs": [
    {
      "name": "layers",
      "type": "voxel_layers",
      "description": "List of voxel layers (DFS-flattened focus subtree); UI-hidden, but flows via NODE_OUTPUT into the renderer's layers bucket.",
      "label": "layers"
    },
    {
      "name": "names",
      "type": "name_list",
      "description": "Name list aligned with layers (id/name/type; name prefers attributes.asset_name, type prefers attributes.asset_type).",
      "label": "names"
    },
    {
      "name": "scene",
      "type": "scene",
      "description": "Scene port value carrying graph and focus.",
      "label": "scene"
    }
  ],
  "deterministic": true
})
