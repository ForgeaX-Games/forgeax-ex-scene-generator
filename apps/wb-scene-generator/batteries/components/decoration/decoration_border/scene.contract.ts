// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "decorationBorder",
  "contractVersion": "3.0.0",
  "opId": "decoration_border",
  "description": "Place 1×1 decoration stamps around the border of a single base grid with configurable fill mode (random, spaced random, equidistant, sequential) and signed offset distance. Each decoration type gets an ascending fill value (from max+1); outputs one multi-value decoration grid and a name list. The engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D integer grid (grid[y][x]); non-zero cells define the reference region boundary. The engine fans out a DataTree of grids one-by-one.",
      "label": "基准网格"
    },
    {
      "name": "decorationName",
      "type": "string",
      "defaultValue": "",
      "description": "Decoration spec: single name '树木'; multi-name '树木，小草' (split by comma/semicolon/newline/pipe, evenly cycled by count); or object array [{\"树木\":3}] (each placed by its own count).",
      "label": "装饰物名称",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "defaultValue": 20,
      "description": "Number of decoration stamps to place; clamped to available border positions.",
      "label": "填充数量",
      "mode": "parameter"
    },
    {
      "name": "rotate",
      "type": "bool",
      "access": "item",
      "defaultValue": false,
      "description": "Reserved parameter (has no effect for 1×1 stamps).",
      "label": "是否旋转"
    },
    {
      "name": "fillMode",
      "type": "string",
      "access": "item",
      "defaultValue": "random",
      "description": "random=fully random; spaced_random=random with min 1-cell gap; equidistant=angular equidistant; sequential=sequential from random start points.",
      "label": "填充方式",
      "options": [
        "random",
        "spaced_random",
        "equidistant",
        "sequential"
      ],
      "mode": "parameter"
    },
    {
      "name": "offset",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Gap in cells between the stamp edge and the base grid boundary: positive=outside gap, 0=touching boundary, negative=overlapping inside.",
      "label": "偏移距离",
      "mode": "parameter"
    },
    {
      "name": "startCount",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "sequential mode only: number of random starting points; each start fills forward independently.",
      "label": "起点数量",
      "mode": "parameter"
    },
    {
      "name": "itemSpacing",
      "type": "number",
      "access": "item",
      "defaultValue": 8,
      "description": "sequential mode only: cell gap between consecutive stamp edges along the ring.",
      "label": "物品间距",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "A single multi-value grid containing only decoration stamps; each type uses an ascending fill value (from max(grid)+1). With a grid-list input the engine emits one per branch as a DataTree.",
      "label": "输出网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Decoration name list in [{id, name, type}] format, containing the assigned fill values and names.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
