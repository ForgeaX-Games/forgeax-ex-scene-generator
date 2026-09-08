// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furniturePlacer",
  "contractVersion": "1.0.0",
  "opId": "furniture_placer",
  "description": "Places furniture into a room grid based on the room layout, existing masks, and a prioritized furniture list; outputs updated body mask, aisle mask, and furniture index.",
  "inputs": [
    {
      "name": "roomGrid",
      "type": "grid",
      "description": "Room interior grid: 1 = walkable cell, 0 = wall or outside.",
      "label": "室内空间网格"
    },
    {
      "name": "maskA",
      "type": "grid",
      "description": "Furniture body occupancy grid; pass all-zero grid when there is no existing furniture.",
      "label": "家具实体网格 (maskA)"
    },
    {
      "name": "maskB",
      "type": "grid",
      "description": "Aisle reservation grid; pass all-zero grid when there is no existing furniture.",
      "label": "过道预留网格 (maskB)"
    },
    {
      "name": "oldFurnitureIndex",
      "type": "array",
      "description": "Index of already-placed furniture items (rank/name/isGroup); pass empty array if none.",
      "label": "旧家具编号列表"
    },
    {
      "name": "furnitureList",
      "type": "array",
      "description": "Main furniture list to place (from furniture_rank_split main_list output), each item with rank/name/furniture_id/type/placement.",
      "label": "主家具清单"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "description": "Random seed for placement; same seed produces the same layout. Default: 42.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "newMaskA",
      "type": "grid",
      "description": "Updated furniture body mask after placement; non-zero values are effective rank numbers.",
      "label": "新家具实体网格"
    },
    {
      "name": "newMaskB",
      "type": "grid",
      "description": "Updated aisle reservation mask after placement; 1 = reserved aisle cell.",
      "label": "新过道预留网格"
    },
    {
      "name": "furnitureIndex",
      "type": "array",
      "description": "Complete furniture index (old + new), each item containing rank (grid value), name, and isGroup flag.",
      "label": "家具编号列表"
    },
    {
      "name": "diagnostics",
      "type": "array",
      "description": "Diagnostic log of the placement process, including result or skip reason for each furniture item.",
      "label": "诊断日志"
    }
  ],
  "deterministic": true
})
