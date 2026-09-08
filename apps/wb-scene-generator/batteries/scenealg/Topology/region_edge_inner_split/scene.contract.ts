// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionEdgeInnerSplit",
  "contractVersion": "1.0.0",
  "opId": "alg_region_edge_inner_split",
  "description": "Splits a region into edge cells and inner cells as two 0/1 masks. For each valid (non-zero) cell it checks its connectivity neighbors (default 4-connectivity: up/down/left/right); if any neighbor is out of bounds or non-valid the cell is an edge cell, otherwise an inner cell. edge and inner are mutually exclusive and their union equals all valid cells of the region. Useful for two-tier differential fill (dense edges, sparse interior): wire edge / inner into region_random_fill with different densities. Emits only the edge/inner masks, no probability or semantics.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) region grid; valid cells are non-zero.",
      "label": "输入区域"
    },
    {
      "name": "connectivity",
      "type": "number",
      "defaultValue": 4,
      "description": "Neighbor connectivity for edge detection: 4 = up/down/left/right (default, matches legacy fillEdge), 8 = include diagonals.",
      "label": "邻接度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "edge",
      "type": "grid",
      "access": "item",
      "description": "0/1 mask matching the input shape; edge valid cells = 1, others = 0.",
      "label": "边缘格"
    },
    {
      "name": "inner",
      "type": "grid",
      "access": "item",
      "description": "0/1 mask matching the input shape; inner valid cells = 1, others = 0.",
      "label": "内部格"
    },
    {
      "name": "edgeCount",
      "type": "number",
      "access": "item",
      "description": "Number of valid cells classified as edge.",
      "label": "边缘格数"
    },
    {
      "name": "innerCount",
      "type": "number",
      "access": "item",
      "description": "Number of valid cells classified as inner.",
      "label": "内部格数"
    }
  ],
  "deterministic": true
})
