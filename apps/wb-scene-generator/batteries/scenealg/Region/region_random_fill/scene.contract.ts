// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionRandomFill",
  "contractVersion": "1.0.0",
  "opId": "alg_region_random_fill",
  "description": "Random raster fill in density or count mode, emitting a 0/1 point mask matching the input shape. mode=density (default) keeps each valid cell as 1 with probability density (1 = full, 0 = empty) via pure per-cell Bernoulli sampling; mode=count fills an exact number of cells: without an edge input, shuffle candidate cells and take the first count (fillRandomCount); with an edge second input, split valid cells into edge/inner by the edge mask, shuffle each and concatenate (edge first), taking the first count (fillEdgeCount, edge-priority exact-count fill). Usable for crop points, grass/pebble scatter, exact-count placement, etc.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; sampling only on non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "edge",
      "type": "grid",
      "access": "item",
      "required": false,
      "description": "Optional second input, count mode only: non-zero cells are edge cells, remaining valid cells are inner; fill takes the first count edge-first (fillEdgeCount).",
      "label": "边缘掩码"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "density",
      "description": "density = per-cell Bernoulli sampling by probability (default, backward compatible); count = exact-count fill.",
      "label": "填充模式",
      "mode": "parameter"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.9,
      "description": "density mode: probability of keeping each valid cell as 1, 0..1. 1 = full coverage, 0 = empty.",
      "label": "填充密度",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 0,
      "description": "count mode: exact number of cells to keep (clamped to the number of valid cells).",
      "label": "目标格数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "description": "A 0/1 point mask matching the input shape; kept cells = 1, others = 0.",
      "label": "填充网格"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of cells actually kept as 1.",
      "label": "保留格数"
    }
  ],
  "deterministic": true
})
