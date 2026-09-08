// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "randomRectScatter",
  "contractVersion": "1.0.0",
  "opId": "random_rect_scatter",
  "description": "Scatters several rectangles around each input point: random direction + a controllable approximate point-to-rectangle distance (center distance with random jitter) + random size. Outputs one multi-value grid (each rectangle an increasing id) and a list of 0/1 rectangle grids. region only defines the output grid size; rectangles are clipped to bounds. Coordinates: x→column, y→row.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Region/canvas grid used only to size the output; generated rectangles are clipped to its row/column bounds.",
      "label": "输入区域"
    },
    {
      "name": "points",
      "type": "point2d",
      "access": "list",
      "required": true,
      "description": "A list of sampled point2d (consumed atomically); x→column, y→row. Rectangles are scattered around each point.",
      "label": "中心点集"
    },
    {
      "name": "countPerPoint",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Number of rectangles generated around each point. Default 3.",
      "label": "每点矩形数",
      "mode": "parameter"
    },
    {
      "name": "distance",
      "type": "number",
      "access": "item",
      "defaultValue": 6,
      "description": "Approximate distance between each rectangle and its point (point to rectangle center). Default 6.",
      "label": "与点距离",
      "mode": "parameter"
    },
    {
      "name": "distanceJitter",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Random +/- jitter on the distance; actual distance is uniform in [distance-jitter, distance+jitter]. Default 2.",
      "label": "距离波动",
      "mode": "parameter"
    },
    {
      "name": "minSize",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Minimum rectangle side length in cells. Default 2.",
      "label": "最小边长",
      "mode": "parameter"
    },
    {
      "name": "maxSize",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "Maximum rectangle side length in cells. Default 5.",
      "label": "最大边长",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current time.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each rectangle gets an increasing id, 0 elsewhere; pipe to grid_split_by_value or the wall-frame battery.",
      "label": "矩形网格"
    },
    {
      "name": "rects",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid (same shape as region) per rectangle, in generation order; a fully out-of-bounds rectangle yields an all-zero grid.",
      "label": "矩形列表"
    }
  ],
  "deterministic": true
})
