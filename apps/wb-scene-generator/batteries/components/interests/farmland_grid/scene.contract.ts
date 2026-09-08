// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "farmlandGrid",
  "contractVersion": "2.0.0",
  "opId": "farmland_grid",
  "description": "Generate a farmland plot layout from a single floor mask using grid, strip, or BSP subdivision. Outputs one multi-value grid: 1=path ridge(tile), 2=farmland(tile), 3=rice/4=wheat/5=corn/6=vegetable(asset, sparse by plantDensity). Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single plantable area mask grid (non-zero cells treated as valid farmland). The engine fans out a grid list one-by-one.",
      "label": "可用区域"
    },
    {
      "name": "layout",
      "type": "string",
      "access": "item",
      "defaultValue": "grid",
      "description": "Layout algorithm: grid=uniform grid, strip=strips with random direction per farmland (horizontal or vertical, seeded), bsp=BSP subdivision.",
      "label": "布局形式",
      "options": [
        "grid",
        "strip",
        "bsp"
      ],
      "mode": "parameter"
    },
    {
      "name": "plotWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Width in columns of each plot (used by grid/bsp; minimum 2).",
      "label": "地块宽度",
      "mode": "parameter"
    },
    {
      "name": "plotHeight",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Height in rows of each plot (used by all layouts; minimum 2).",
      "label": "地块高度",
      "mode": "parameter"
    },
    {
      "name": "pathWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Width in cells of the path between plots (minimum 1).",
      "label": "小径宽度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed for BSP layout; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "plantDensity",
      "type": "number",
      "access": "item",
      "defaultValue": 0.9,
      "description": "Density of crop asset points, 0~1. 1 = fully covered, 0 = none. Default 0.9.",
      "label": "植物密度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: 1=path(tile), 2=farmland(tile), 3=rice/4=wheat/5=corn/6=vegetable(asset); pipe to grid_split_by_value to separate semantics.",
      "label": "农田网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list with only ids actually present, format [{id, name, type}]. Path/farmland type=tile; crop points type=asset (rice/wheat/corn/vegetable).",
      "label": "农田名称清单"
    }
  ],
  "deterministic": true
})
