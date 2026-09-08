// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "connectivityToMultivalue",
  "contractVersion": "1.0.0",
  "opId": "connectivity_to_multivalue",
  "description": "Labels each 4-connected region in every grid of the input list with a unique integer, converting single-value grids to multi-value grids; the starting ID is automatically set to max(grid)+1.",
  "inputs": [
    {
      "name": "gridList",
      "type": "any",
      "description": "List of input grids; each grid's 4-connected regions will be labeled with unique integer values.",
      "label": "网格列表"
    },
    {
      "name": "filterValue",
      "type": "number",
      "defaultValue": 0,
      "description": "The boundary value treated as a barrier; cells with this value are excluded from connectivity and kept as-is.",
      "label": "过滤值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "Same-length list; each grid has its 4-connected regions labeled with unique integers starting from max(grid)+1.",
      "label": "多值网格列表"
    }
  ],
  "deterministic": true
})
