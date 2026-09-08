// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "poissonRoomPlacement",
  "contractVersion": "1.0.0",
  "opId": "poisson_room_placement",
  "description": "Place non-overlapping rectangular rooms on a grid using Poisson disk sampling for even distribution; room cells hold room IDs, empty cells are 0.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 50,
      "description": "Width (columns) of the output grid.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 50,
      "description": "Height (rows) of the output grid.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "minRoomW",
      "type": "number",
      "defaultValue": 3,
      "description": "Minimum room width in cells.",
      "label": "最小房间宽度",
      "mode": "parameter"
    },
    {
      "name": "maxRoomW",
      "type": "number",
      "defaultValue": 8,
      "description": "Maximum room width in cells.",
      "label": "最大房间宽度",
      "mode": "parameter"
    },
    {
      "name": "minRoomH",
      "type": "number",
      "defaultValue": 3,
      "description": "Minimum room height in cells.",
      "label": "最小房间高度",
      "mode": "parameter"
    },
    {
      "name": "maxRoomH",
      "type": "number",
      "defaultValue": 8,
      "description": "Maximum room height in cells.",
      "label": "最大房间高度",
      "mode": "parameter"
    },
    {
      "name": "gap",
      "type": "number",
      "defaultValue": 1,
      "description": "Minimum gap (in cells) between rooms.",
      "label": "房间间距",
      "mode": "parameter"
    },
    {
      "name": "radius",
      "type": "number",
      "defaultValue": 0,
      "description": "Poisson disk sampling radius controlling candidate density; 0 for auto.",
      "label": "采样半径",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: 0=empty, positive integers=room IDs.",
      "label": "房间网格"
    },
    {
      "name": "rooms",
      "type": "dict",
      "description": "Array of room info objects: [{id, x, y, w, h, centerX, centerY}] (rank=1).",
      "label": "房间列表"
    },
    {
      "name": "numRooms",
      "type": "number",
      "description": "Total number of rooms successfully placed.",
      "label": "房间数量"
    }
  ],
  "deterministic": true
})
