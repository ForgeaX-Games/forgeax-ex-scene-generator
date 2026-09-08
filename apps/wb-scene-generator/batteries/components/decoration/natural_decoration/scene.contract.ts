// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "naturalDecoration",
  "contractVersion": "4.0.0",
  "opId": "natural_decoration",
  "description": "Treats all non-zero cells in a single input grid as the target region, then fills decorations in rounds per the decoration list. Outputs one multi-value grid (each decoration type gets an ascending id, others are 0). The engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D integer grid (grid[y][x]); non-zero cells are the fillable region. The engine fans out a DataTree of grids one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "decorations",
      "type": "array",
      "description": "Array of decorations, or a string parsed to a list (JSON array, or comma-separated like name:40 with default density 30).",
      "label": "装饰物清单"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "random",
      "description": "Fill algorithm: random, cluster, edge, noise, or poisson.",
      "label": "填充算法",
      "options": [
        "random",
        "cluster",
        "edge",
        "noise",
        "poisson"
      ],
      "mode": "parameter"
    },
    {
      "name": "densityMode",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "true=density mode (density is a percentage 0-100); false=count mode (density is the exact number of cells to place in the target region).",
      "label": "密度模式",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 produces a different result each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "A single multi-value grid; each decoration type uses an ascending id (from max(grid)+1), others are 0. With a grid-list input the engine emits one per branch as a DataTree.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Decoration entries actually written to the grid; each is {id, name, type} with type always \"asset\".",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
