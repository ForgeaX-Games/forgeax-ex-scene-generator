// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "bspRoomGenerator",
  "contractVersion": "1.0.0",
  "opId": "bsp_room_generator",
  "description": "Generates rectangular rooms via Binary Space Partition: recursively splits the space and places rooms in leaf nodes.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 50,
      "description": "Width of the output grid in pixels/columns.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 50,
      "description": "Height of the output grid in pixels/rows.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "minRoomSize",
      "type": "number",
      "defaultValue": 5,
      "description": "Minimum room side length; splitting stops when a partition is smaller than twice this value.",
      "label": "最小房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "maxRoomSize",
      "type": "number",
      "defaultValue": 12,
      "description": "Maximum room side length; room size is randomized between min and max.",
      "label": "最大房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "minSplitRatio",
      "type": "number",
      "defaultValue": 0.4,
      "description": "Lower bound of the BSP split position ratio (0.3~0.5).",
      "label": "最小分割比",
      "mode": "parameter"
    },
    {
      "name": "maxSplitRatio",
      "type": "number",
      "defaultValue": 0.6,
      "description": "Upper bound of the BSP split position ratio (0.5~0.7).",
      "label": "最大分割比",
      "mode": "parameter"
    },
    {
      "name": "wallPadding",
      "type": "number",
      "defaultValue": 1,
      "description": "Minimum padding between rooms and partition edges; larger values create more spacing.",
      "label": "墙壁边距",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different layouts.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: 0=wall, positive integers=room IDs.",
      "label": "房间网格"
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
      "description": "Total number of rooms generated.",
      "label": "房间数量"
    }
  ],
  "deterministic": true
})
