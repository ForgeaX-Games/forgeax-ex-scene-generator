// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "bspGrid",
  "contractVersion": "1.0.0",
  "opId": "bsp_grid",
  "description": "Recursively partitions the available area of an input grid using Binary Space Partitioning (BSP) to generate a multi-room layout, filling each room with a unique ID.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid whose dimensions (rows × cols) define the generation area; cell values are not used.",
      "label": "输入网格"
    },
    {
      "name": "minRoomSize",
      "type": "number",
      "defaultValue": 20,
      "description": "Minimum cell count in any direction (including walls); leaf nodes smaller than this will not be split.",
      "label": "最小房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "maxDepth",
      "type": "number",
      "defaultValue": 2,
      "description": "Maximum BSP recursion depth, which limits the total number of rooms.",
      "label": "最大分割深度",
      "mode": "parameter"
    },
    {
      "name": "wallThickness",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of wall cells reserved at each room boundary (minimum 1).",
      "label": "墙体厚度",
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
      "name": "outputGrid",
      "type": "grid",
      "description": "Output multi-value grid where each room region is filled with a unique positive integer ID; walls and unassigned areas are 0.",
      "label": "房间网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "List mapping each room ID to its name, formatted as [{id, name}].",
      "label": "名称清单"
    },
    {
      "name": "roomCount",
      "type": "number",
      "description": "Total number of rooms generated.",
      "label": "房间总数"
    }
  ],
  "deterministic": true
})
