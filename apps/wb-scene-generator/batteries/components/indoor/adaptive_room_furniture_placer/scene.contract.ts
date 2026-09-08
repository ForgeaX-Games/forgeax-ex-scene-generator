// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "adaptiveRoomFurniturePlacer",
  "contractVersion": "3.0.0",
  "opId": "adaptive_room_furniture_placer",
  "description": "Adaptive per-room furniture placer on a single room grid: small rooms (area≤10) get only small furniture, large rooms (area≥40) get all sizes. Accepts roomGrid, doorGrid, and furnitureList (rank 1-7 → main, rank 8-9 → fill). Outputs per-instance nameList and outputGrid. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "roomGrid",
      "type": "grid",
      "access": "item",
      "description": "Single room grid (1=available, 0=wall). The engine fans out a grid list one-by-one, pairing doorGrid per branch.",
      "label": "房间网格"
    },
    {
      "name": "doorGrid",
      "type": "grid",
      "access": "item",
      "description": "Door position grid (non-zero=door), reserves space around doors; paired with roomGrid per branch.",
      "label": "门位置网格"
    },
    {
      "name": "furnitureList",
      "type": "array",
      "description": "Unified furniture list. rank 1-7 → main furniture, rank 8-9 → filler furniture (broadcast to every grid).",
      "label": "家具清单"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 42,
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
      "description": "Collapsed furniture grid; pixel value = nameList id.",
      "label": "家具网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Per-instance name list [{id, name, type, direction}].",
      "label": "家具名称清单"
    },
    {
      "name": "furnitureIndex",
      "type": "array",
      "access": "item",
      "description": "Raw furniture index before collapse.",
      "label": "家具编号列表"
    },
    {
      "name": "roomReport",
      "type": "array",
      "access": "item",
      "description": "Per-room placement summary for debugging.",
      "label": "房间放置报告"
    }
  ],
  "deterministic": true
})
