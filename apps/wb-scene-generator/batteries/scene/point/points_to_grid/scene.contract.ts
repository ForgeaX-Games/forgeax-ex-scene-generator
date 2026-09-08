// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "pointsToGrid",
  "contractVersion": "1.0.0",
  "opId": "points_to_grid",
  "description": "Take a list of point2d and a region grid; output a 0/1 mask (same shape as the region) where cells that lie on a valid (non-zero) region cell AND hit a point in the list are marked 1, others 0. Coordinates: x→column, y→row, rounded; out-of-bounds or outside-region points are ignored.",
  "inputs": [
    {
      "name": "points",
      "type": "point2d",
      "access": "list",
      "required": true,
      "description": "List of point2d; x→column, y→row.",
      "label": "点列表"
    },
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) region grid; only points on non-zero valid cells are marked.",
      "label": "输入区域"
    }
  ],
  "outputs": [
    {
      "name": "mask",
      "type": "grid",
      "access": "item",
      "description": "A 0/1 mask (same shape as the region) with 1s at hit points.",
      "label": "输出掩码"
    }
  ],
  "deterministic": true
})
