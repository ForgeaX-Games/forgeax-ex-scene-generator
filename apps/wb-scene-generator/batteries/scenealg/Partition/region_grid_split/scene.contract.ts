// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionGridSplit",
  "contractVersion": "1.0.0",
  "opId": "alg_region_grid_split",
  "description": "Regular grid subdivision inside a region's bounding box: split along both rows and columns at cellHeight×cellWidth, leaving a gapWidth separator between cells that serves as both horizontal and vertical paths. Each grid cell is emitted as its own 0/1 grid (row-major order), and all gaps are merged into one gap grid. Any non-divisible remainder along each axis is folded into one random band.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; cells fall only on non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "cellWidth",
      "type": "number",
      "defaultValue": 4,
      "description": "Column width of each grid cell (in cells), minimum 1.",
      "label": "单元列宽",
      "mode": "parameter"
    },
    {
      "name": "cellHeight",
      "type": "number",
      "defaultValue": 4,
      "description": "Row height of each grid cell (in cells), minimum 1.",
      "label": "单元行高",
      "mode": "parameter"
    },
    {
      "name": "gapWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Gap width between cells (shared by rows and columns), minimum 0. Gap cells go to the gap output.",
      "label": "间隙宽度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed (used to assign row/column remainder to a random band); 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per grid cell, row-major order; empty cells clipped away by the mask are dropped.",
      "label": "单元列表"
    },
    {
      "name": "gap",
      "type": "grid",
      "access": "item",
      "description": "A single 0/1 grid merging all horizontal and vertical gaps; same shape as the input.",
      "label": "间隙网格"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of non-empty grid cells produced.",
      "label": "单元数"
    }
  ],
  "deterministic": true
})
