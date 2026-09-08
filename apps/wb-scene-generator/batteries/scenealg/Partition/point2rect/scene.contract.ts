// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPoint2rect",
  "contractVersion": "1.0.0",
  "opId": "alg_point2rect",
  "description": "Fit a rectangle around a sampled point2d inside the valid (1) area of a 0/1 region grid: center as close to the point as possible, size as close to the target width/height as possible, fully contained in the region, shrinking if it doesn't fit. If the point lands on a 0 cell, the nearest 1 cell anchors it; at least one cell is kept as long as any valid cell exists in the region. An all-zero region (no valid cells at all) now returns an explicit error instead of silently yielding an all-zero grid (2026-07-01 postmortem fix — prevents PlaceOneDecoration/PickOneBuilding from silently producing an invisible node). Output is a new grid (same shape) with 1s in the rectangle. Coordinates: x→column, y→row.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) region grid; the rectangle is searched only within non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "point",
      "type": "point2d",
      "access": "item",
      "required": true,
      "description": "Sampled point2d (x→column, y→row); the rectangle center stays as close to it as possible.",
      "label": "采样点"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 5,
      "description": "Target rectangle width in columns; shrinks if it doesn't fit, minimum 1.",
      "label": "目标宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 5,
      "description": "Target rectangle height in rows; shrinks if it doesn't fit, minimum 1.",
      "label": "目标高度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "A 0/1 grid (same shape as input) with 1s in the fitted rectangle and 0s elsewhere.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
