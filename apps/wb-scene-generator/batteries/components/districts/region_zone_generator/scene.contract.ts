// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "regionZoneGenerator",
  "contractVersion": "2.0.0",
  "opId": "region_zone_generator",
  "description": "Partition the usable area of a single mask grid into non-overlapping irregular zones from a region list (area ratio, 1-9 grid position). Outputs one multi-value grid (each zone gets an ascending ID). Grid lists are fanned out one-by-one as a DataTree.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D grid (grid[y][x]); non-zero cells are usable area, zero cells are unavailable. The engine fans out a grid list one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "regions",
      "type": "array",
      "description": "Region descriptor array or JSON string. Each item: [area, position(1-9)] or [name, area, position] (name is a readable comment only). Area is measured against areaScale: if the sum < areaScale the zones only cover sum/areaScale of the area (rest left empty); if >= areaScale they split the whole area proportionally.",
      "label": "区域列表"
    },
    {
      "name": "areaScale",
      "type": "number",
      "access": "item",
      "defaultValue": 10,
      "description": "Full-coverage denominator. When the sum of region areas reaches this value the zones fill the whole usable area; otherwise they cover sum/areaScale and leave the rest empty.",
      "label": "满铺基准",
      "mode": "parameter"
    },
    {
      "name": "boundaryStyle",
      "type": "string",
      "access": "item",
      "defaultValue": "rectilinear",
      "description": "Boundary post-processing style: organic, smooth, rectilinear, or voronoi.",
      "label": "边界风格",
      "options": [
        "organic",
        "smooth",
        "rectilinear",
        "voronoi"
      ],
      "mode": "parameter"
    },
    {
      "name": "relaxIterations",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "Lloyd relaxation iterations. More iterations = more uniform distribution. Recommended: 3-8.",
      "label": "松弛迭代次数",
      "mode": "parameter"
    },
    {
      "name": "smoothIterations",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "CA smoothing iterations for organic/smooth styles. Recommended: 3-10.",
      "label": "平滑迭代次数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp for a different result each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "A single multi-value grid; each zone is written with an ascending ID (1,2,3,...), unassigned cells are 0. Feed into grid2node.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
