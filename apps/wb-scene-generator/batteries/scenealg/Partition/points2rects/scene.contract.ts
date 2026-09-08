// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPoints2rects",
  "contractVersion": "1.0.0",
  "opId": "alg_points2rects",
  "description": "Fits one rectangle per sampled point2d inside the valid (1) area of a 0/1 region grid: each rectangle's center stays close to its point, its size close to the target width/height, fully contained in the region, shrinking if needed, and all rectangles are mutually non-overlapping. When space is contested, larger target areas are placed first (big rects grab better spots). Each point yields a separate 0/1 grid (same shape, 1s in the rectangle) as a rank=1 list, in input order; points that cannot be placed yield an all-zero grid. width/height broadcast to all points when length 1, otherwise zip by index, defaulting to 5. Coordinates: x→column, y→row.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) region grid; rectangles are searched only within non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "points",
      "type": "point2d",
      "access": "list",
      "required": true,
      "description": "A list of sampled point2d (consumed atomically); x→column, y→row. Each point gets its own rectangle whose center stays close to it.",
      "label": "采样点集"
    },
    {
      "name": "widths",
      "type": "number",
      "access": "list",
      "description": "Target rectangle width (columns) per point. Broadcasts to all points when length 1, otherwise zips by index; defaults to 5, minimum 1, shrinks if it doesn't fit.",
      "label": "目标宽度",
      "mode": "parameter"
    },
    {
      "name": "heights",
      "type": "number",
      "access": "list",
      "description": "Target rectangle height (rows) per point. Broadcasts to all points when length 1, otherwise zips by index; defaults to 5, minimum 1, shrinks if it doesn't fit.",
      "label": "目标高度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "rects",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per input point (same shape as the region; 1s in the fitted rectangle, 0s elsewhere), in input order; an unplaceable point yields an all-zero grid. Rectangles across all grids are mutually non-overlapping.",
      "label": "矩形网格列表"
    },
    {
      "name": "placedCount",
      "type": "number",
      "access": "item",
      "description": "Number of rectangles successfully placed (non-empty); may be less than the number of input points.",
      "label": "实际放置数量"
    }
  ],
  "deterministic": true
})
