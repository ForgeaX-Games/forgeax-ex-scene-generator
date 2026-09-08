// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridBinarize",
  "contractVersion": "1.0.0",
  "opId": "grid_binarize",
  "description": "Binarizes a grid by threshold; cells above the threshold become 1, others become 0.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid to binarize.",
      "label": "输入网格"
    },
    {
      "name": "threshold",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Binarization threshold; cell value > threshold → 1, otherwise → 0 (0~1).",
      "label": "阈值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Binarized output grid with values 0 or 1 only.",
      "label": "二值网格"
    }
  ],
  "deterministic": true
})
