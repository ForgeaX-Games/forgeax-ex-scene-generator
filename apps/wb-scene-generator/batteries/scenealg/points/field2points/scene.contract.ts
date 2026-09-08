// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algField2points",
  "contractVersion": "1.0.0",
  "opId": "alg_field2points",
  "description": "Samples a list of points from a scalar field (a field — one value per cell) by threshold: iterate all cells of the input field in row-major order (r outer, c inner); for every cell whose value is strictly greater than threshold, emit a single-point 0/1 grid matching the input size (only that cell = 1, the rest = 0). All such single-point grids form a list (DataTree) in row-major order. Each output grid has exactly one 1; the list length equals the number of cells above the threshold; an empty list is output when no cell exceeds the threshold. Useful for discretizing continuous scalar fields (e.g. field_noise / field_distance) into a set of per-point samples.",
  "inputs": [
    {
      "name": "field",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Input scalar field / grid (number[][]), one continuous value per cell. Points are sampled on it by threshold.",
      "label": "输入标量场"
    },
    {
      "name": "threshold",
      "type": "number",
      "defaultValue": 0,
      "description": "Sampling threshold. Only cells whose value is strictly greater than threshold are sampled as a point; cells equal to the threshold are not selected.",
      "label": "阈值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "points",
      "type": "grid",
      "access": "list",
      "description": "List of sampled points (grid[]): each cell whose field value > threshold yields a 0/1 grid matching the input size (only that cell = 1, the rest = 0), in row-major order. List length equals the number of cells above the threshold; an empty list when none exceed it.",
      "label": "采样点列表"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Number of cells above the threshold, i.e. the length of the points list (count of sampled points).",
      "label": "采样点数"
    }
  ],
  "deterministic": true
})
