// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "siheyuanWallFrame",
  "contractVersion": "1.0.0",
  "opId": "siheyuan_wall_frame",
  "description": "Takes multiple rectangles (each a 0/1 grid, or one multi-value grid with a distinct id per rectangle), draws the center line along each rectangle's long edge, orders them in a ring around the overall centroid, and stitches the center lines head-to-tail with connector segments into one closed frame. Outputs a single wall grid. Coordinates: x→column, y→row.",
  "inputs": [
    {
      "name": "rects",
      "type": "grid",
      "access": "list",
      "required": true,
      "description": "Rectangle input: a list of 0/1 grids (one rectangle each), or a single multi-value grid (each distinct non-zero id is one rectangle). The long-edge center line is derived from each rectangle's bounding box.",
      "label": "矩形列表"
    },
    {
      "name": "thickness",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Wall line thickness in grid cells; 1 is a single-cell thin line, larger values widen the wall.",
      "label": "围墙厚度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "wall",
      "type": "grid",
      "access": "item",
      "description": "Single wall grid: cells on the closed frame (the long-edge center lines plus their connectors) are 1, others are 0.",
      "label": "围墙网格"
    }
  ],
  "deterministic": true
})
