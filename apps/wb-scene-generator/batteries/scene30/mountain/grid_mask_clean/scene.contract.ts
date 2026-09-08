// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridMaskClean",
  "contractVersion": "2.0.0",
  "opId": "grid_mask_clean",
  "description": "Batch morphological cleanup for a list of mask grids: fills small enclosed holes and removes tiny isolated islands.",
  "inputs": [
    {
      "name": "inputGrids",
      "type": "array",
      "description": "List of mask grids to clean (e.g. contour layers); each grid is processed independently, 0 is background.",
      "label": "网格列表"
    },
    {
      "name": "minHoleSize",
      "type": "number",
      "defaultValue": 20,
      "description": "Zero-regions with area ≤ this value that are fully enclosed by a single color will be filled. Default 20.",
      "label": "最大孔洞面积",
      "mode": "parameter"
    },
    {
      "name": "minIslandSize",
      "type": "number",
      "defaultValue": 10,
      "description": "Non-zero connected regions with area < this value will be removed (set to 0). Default 10.",
      "label": "最小岛屿面积",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrids",
      "type": "array",
      "description": "Cleaned grid list after hole filling and island removal, same length as input.",
      "label": "清理后列表"
    }
  ],
  "deterministic": true
})
