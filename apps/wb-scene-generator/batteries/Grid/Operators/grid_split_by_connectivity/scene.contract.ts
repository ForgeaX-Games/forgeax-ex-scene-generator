// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridSplitByConnectivity",
  "contractVersion": "2.0.0",
  "opId": "grid_split_by_connectivity",
  "description": "Splits a grid into a list of grids by 4-directional connectivity, using the filter value as the boundary; each connected region becomes an independent grid.",
  "inputs": [
    {
      "name": "inputGrids",
      "type": "grid",
      "access": "item",
      "description": "Grid to split (single- or multi-value); multi-grid batching is handled by the dispatcher fanout.",
      "label": "输入网格"
    },
    {
      "name": "filterValue",
      "type": "number",
      "defaultValue": 0,
      "description": "The boundary value treated as a barrier; cells with this value are excluded from connectivity.",
      "label": "过滤值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "gridsList",
      "type": "grid",
      "access": "list",
      "description": "All 4-connected components of the input grid; each keeps original values (others set to 0) and becomes its own child branch.",
      "label": "网格列表"
    }
  ],
  "deterministic": true
})
