// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "townIslandLayout",
  "contractVersion": "2.0.0",
  "opId": "town_island_layout",
  "description": "Generate a chess-grid road network via BSP on a single grid, then clip it to an island shape (circle/ellipse/organic). Outputs one multi-value grid (road + parcels). Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single source mask grid (number[][]); any non-zero cell is treated as a valid area. The engine fans out a grid list one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Road thickness in grid cells. Default 1.",
      "label": "道路宽度",
      "mode": "parameter"
    },
    {
      "name": "blockMinSize",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Minimum side length of any BSP block, controls road and parcel density. Default 3.",
      "label": "块最小尺寸",
      "mode": "parameter"
    },
    {
      "name": "shapeType",
      "type": "string",
      "access": "item",
      "defaultValue": "ellipse",
      "description": "Geometric shape used to clip the island: circle, ellipse (random rotation), or organic (sine-distorted ellipse).",
      "label": "岛型形状",
      "options": [
        "circle",
        "ellipse",
        "organic"
      ],
      "mode": "parameter"
    },
    {
      "name": "shapeScale",
      "type": "number",
      "access": "item",
      "defaultValue": 0.6,
      "description": "Fraction of the bounding-box area the island shape covers (0.2–0.9). Default 0.6.",
      "label": "岛型比例",
      "mode": "parameter"
    },
    {
      "name": "coverageThreshold",
      "type": "number",
      "access": "item",
      "defaultValue": 0.6,
      "description": "Minimum fraction of a parcel's cells inside the island shape to keep it (0–1). Kept parcels are output whole. Default 0.6.",
      "label": "覆盖率阈值",
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
      "description": "Single multi-value grid: road=1, each parcel an ascending id from 2; pipe to grid_split_by_value to separate road and parcels.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "[{id:1,name:'road'}, {id:2,name:'parcel 1'}, ...], type=tile, only ids actually present in the grid.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
