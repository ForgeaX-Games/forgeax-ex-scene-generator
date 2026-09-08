// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridMirror",
  "contractVersion": "1.0.0",
  "opId": "grid_mirror",
  "description": "Mirror (flip) a 2D grid along the horizontal or vertical axis.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input 2D grid to mirror.",
      "label": "输入网格"
    },
    {
      "name": "axis",
      "type": "string",
      "defaultValue": "horizontal",
      "description": "Flip direction: horizontal=left-right swap, vertical=top-bottom swap, both=180° rotation equivalent.",
      "label": "镜像方向",
      "options": [
        "horizontal",
        "vertical",
        "both"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Mirrored 2D grid.",
      "label": "镜像网格"
    }
  ],
  "deterministic": true
})
