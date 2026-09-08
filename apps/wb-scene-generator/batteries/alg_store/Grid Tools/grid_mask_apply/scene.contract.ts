// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridMaskApply",
  "contractVersion": "1.0.0",
  "opId": "grid_mask_apply",
  "description": "Applies a binary mask to a grid; keeps cells where mask = 1, sets cells to 0 where mask = 0.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid to be filtered.",
      "label": "输入网格"
    },
    {
      "name": "mask",
      "type": "grid",
      "description": "Binary mask grid (0/1), must be the same size as input grid; 1 = keep, 0 = set to zero.",
      "label": "掩码网格"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Filtered grid; original values kept where mask = 1, set to 0 where mask = 0.",
      "label": "过滤网格"
    }
  ],
  "deterministic": true
})
