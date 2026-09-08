// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algFieldInnerDistance",
  "contractVersion": "1.0.0",
  "opId": "alg_field_inner_distance",
  "description": "Multi-source BFS distance field to the INNER 0-region boundary. First a border flood-fill classifies 0-cells into outer background (connected to the grid border) vs inner holes (enclosed by the valid region, e.g. islands inside an ocean). By default the sources are valid cells 4-adjacent to inner holes (the inner 0 boundary); when includeOuterBoundary=true, region-edge cells (on the grid border or 4-adjacent to outer-background 0-cells, e.g. a coastline) are added as sources. Source cells get distance 0, +1 per ring; BFS propagates only within valid cells. Invalid cells outside the region output 0; valid cells unreachable by BFS output -1. Use cases: an ocean (with inner islands) yields distance to island shores by default (near=shallow, far=deep); a solid island/land needs includeOuterBoundary=true to get distance to the outer coastline (near=coast, far=inland).",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) region grid; non-zero cells are valid, BFS propagates only within valid cells.",
      "label": "输入区域"
    },
    {
      "name": "includeOuterBoundary",
      "type": "bool",
      "access": "item",
      "defaultValue": false,
      "description": "Whether to also use the region's outer edge (cells on the grid border or 4-adjacent to outer-background 0-cells, e.g. a coastline) as distance sources. Default false (inner holes only). Use false for ocean shallow/deep; use true for island coast/inland.",
      "label": "包含外边界"
    },
    {
      "name": "connectivity",
      "type": "number",
      "defaultValue": 4,
      "description": "BFS neighbor relation: 4 = orthogonal, 8 = with diagonals. Default 4.",
      "label": "邻接方式",
      "mode": "parameter"
    },
    {
      "name": "normalize",
      "type": "bool",
      "defaultValue": false,
      "description": "When true, linearly normalize reachable valid cells' distances to [0,1]. Invalid cells stay 0, unreachable stay -1.",
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
