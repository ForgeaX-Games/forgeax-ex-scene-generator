// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridFilter",
  "contractVersion": "2.0.0",
  "opId": "grid_filter",
  "description": "Filters a list of grids, removing any grid whose non-zero cell count is below the threshold.",
  "inputs": [
    {
      "name": "gridList",
      "type": "grid",
      "access": "list",
      "description": "Input list of grids (all immediate children of the current parent branch, fed as a set).",
      "label": "网格列表"
    },
    {
      "name": "minSize",
      "type": "number",
      "defaultValue": 1,
      "description": "Minimum non-zero cell count threshold; grids with fewer non-zero cells than this value are removed.",
      "label": "最小非零格数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "grid",
      "access": "list",
      "description": "Filtered grid list with small grids removed, preserving input order; each kept grid becomes its own child branch.",
      "label": "过滤后网格列表"
    }
  ],
  "deterministic": true
})
