// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algFieldDistance",
  "contractVersion": "1.0.0",
  "opId": "alg_field_distance",
  "description": "Multi-source BFS distance transform: for the valid (non-zero) cells of the input region, computes each cell's shortest grid distance to a set of sources (a field/scalar field — one distance scalar per cell, as opposed to a 0/1 mask region). BFS propagates only within valid cells and never crosses invalid cells. If source is connected: use source's non-zero cells (that fall on valid cells) as multi-source seeds, outputting each cell's distance to them; if source is not connected: default to using the region's boundary valid cells as sources, i.e. distance to the region boundary. Source cells get distance 0, incrementing by 1 per ring. connectivity=4 is orthogonal, 8 includes diagonals. normalize=true linearly normalizes reachable distances to [0,1]. Invalid cells outside the region output 0; valid cells inside the region that BFS cannot reach output -1 (to distinguish invalid cells from reachable source cells).",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; non-zero cells are valid, BFS propagates only within valid cells.",
      "label": "输入区域"
    },
    {
      "name": "source",
      "type": "grid",
      "access": "item",
      "required": false,
      "description": "Optional source mask. If connected: use its non-zero cells (within valid cells) as multi-source seeds; if not: default to the region's boundary valid cells as sources (distance to boundary).",
      "label": "源网格"
    },
    {
      "name": "connectivity",
      "type": "number",
      "defaultValue": 4,
      "description": "4 = orthogonal, 8 = with diagonals. Default 4. Controls the neighbor relation for distance propagation.",
      "label": "邻接方式",
      "mode": "parameter"
    },
    {
      "name": "normalize",
      "type": "bool",
      "defaultValue": false,
      "description": "When true, linearly normalize reachable valid cells' distances to [0,1] (divide by max distance). Invalid cells stay 0, unreachable stay -1.",
      "label": "归一化"
    }
  ],
  "outputs": [
    {
      "name": "field",
      "type": "grid",
      "access": "item",
      "description": "A distance field (number[][]) matching the input shape: source cells = 0, +1 per ring; invalid cells outside the region = 0; valid cells inside the region unreachable by BFS = -1. With normalize=true, reachable distances are normalized to [0,1]. This is a continuous scalar field, not a 0/1 mask.",
      "label": "距离场"
    }
  ],
  "deterministic": true
})
