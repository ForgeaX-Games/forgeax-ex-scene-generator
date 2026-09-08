// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "roomCorridorWalk",
  "contractVersion": "1.0.0",
  "opId": "room_corridor_walk",
  "description": "Generates rooms and corridors by alternating placement from a starting point; corridors extend in random cardinal directions with optional branching, similar to Terraria-style dungeons.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 50,
      "description": "Width of the output grid.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 50,
      "description": "Height of the output grid.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "maxRooms",
      "type": "number",
      "defaultValue": 6,
      "description": "Maximum number of rooms to generate.",
      "label": "最大房间数",
      "mode": "parameter"
    },
    {
      "name": "minRoomSize",
      "type": "number",
      "defaultValue": 4,
      "description": "Minimum room side length.",
      "label": "最小房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "maxRoomSize",
      "type": "number",
      "defaultValue": 8,
      "description": "Maximum room side length.",
      "label": "最大房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "minCorridorLen",
      "type": "number",
      "defaultValue": 2,
      "description": "Minimum corridor length.",
      "label": "最短走廊",
      "mode": "parameter"
    },
    {
      "name": "maxCorridorLen",
      "type": "number",
      "defaultValue": 5,
      "description": "Maximum corridor length.",
      "label": "最长走廊",
      "mode": "parameter"
    },
    {
      "name": "corridorWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Corridor width in pixels.",
      "label": "走廊宽度",
      "mode": "parameter"
    },
    {
      "name": "branchProb",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Probability of creating a branch after placing a room (0~1); higher values create more branches.",
      "label": "分支概率",
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
      "description": "Room grid: 0=empty, positive integers=room IDs (1, 2, 3...).",
      "label": "房间网格"
    },
    {
      "name": "corridorGrid",
      "type": "grid",
      "description": "Corridor grid: 0=empty, 1=corridor.",
      "label": "走廊网格"
    },
    {
      "name": "rooms",
      "type": "dict",
      "description": "Array of room info: [{id, x, y, w, h, centerX, centerY}] (rank=1).",
      "label": "房间列表"
    },
    {
      "name": "numRooms",
      "type": "number",
      "description": "Total number of rooms actually generated.",
      "label": "房间数量"
    }
  ],
  "deterministic": true
})
