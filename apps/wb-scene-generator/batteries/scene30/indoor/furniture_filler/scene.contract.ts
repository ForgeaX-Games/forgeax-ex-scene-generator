// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureFiller",
  "contractVersion": "1.0.0",
  "opId": "furniture_filler",
  "description": "Repeatedly places fill furniture into a room grid until occupancy limits are reached (65% for edge, 80% for center) or placement fails 5 consecutive times.",
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
      "description": "Furniture body occupancy grid from a prior placement step; pass all-zero grid if none.",
      "label": "家具实体网格 (maskA)"
    },
    {
      "name": "maskB",
      "type": "grid",
      "description": "Aisle reservation grid from a prior placement step; pass all-zero grid if none.",
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
      "description": "Fill furniture list (from furniture_rank_split fill_list output), each item with rank/name/furniture_id/type/placement.",
      "label": "填充家具清单"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "description": "Random seed for filling; same seed produces the same layout. Default: 42.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "newMaskA",
      "type": "grid",
      "description": "Updated furniture body mask after filling; non-zero values are effective rank numbers.",
      "label": "新家具实体网格"
    },
    {
      "name": "newMaskB",
      "type": "grid",
      "description": "Updated aisle reservation mask after filling; 1 = reserved aisle cell.",
      "label": "新过道预留网格"
    },
    {
      "name": "furnitureIndex",
      "type": "array",
      "description": "Complete furniture index (old + new), each item with rank, name, isGroup; same-type fill furniture share the same rank.",
      "label": "家具编号列表"
    },
    {
      "name": "diagnostics",
      "type": "array",
      "description": "Diagnostic log of the fill process, including each placement result, stop reason, and occupancy status.",
      "label": "诊断日志"
    }
  ],
  "deterministic": true
})
