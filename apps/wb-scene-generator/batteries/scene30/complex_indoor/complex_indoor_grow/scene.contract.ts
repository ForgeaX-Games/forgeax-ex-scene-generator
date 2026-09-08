// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorGrow",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_grow",
  "description": "Iterative room growth: 80% direct attach + 20% corridor link, with irregular rooms and contour control.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Grid with initial room",
      "label": "输入网格"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "Existing room data",
      "label": "房间列表"
    },
    {
      "name": "nextRoomId",
      "type": "number",
      "defaultValue": 3,
      "description": "Starting ID for new rooms",
      "label": "起始ID",
      "mode": "parameter"
    },
    {
      "name": "targetRoomCount",
      "type": "number",
      "defaultValue": 20,
      "description": "Target room count excluding corridors",
      "label": "目标房间数",
      "mode": "parameter"
    },
    {
      "name": "corridorProb",
      "type": "number",
      "defaultValue": 0.2,
      "description": "Probability of corridor link (0-1)",
      "label": "走廊概率",
      "mode": "parameter"
    },
    {
      "name": "areaRatioMin",
      "type": "number",
      "defaultValue": 0.8,
      "description": "Min area ratio to parent",
      "label": "面积比下限",
      "mode": "parameter"
    },
    {
      "name": "areaRatioMax",
      "type": "number",
      "defaultValue": 2,
      "description": "Max area ratio (normal)",
      "label": "面积比上限",
      "mode": "parameter"
    },
    {
      "name": "rareLargeProb",
      "type": "number",
      "defaultValue": 0.05,
      "description": "Probability of rare large room",
      "label": "大房间概率",
      "mode": "parameter"
    },
    {
      "name": "rareLargeMax",
      "type": "number",
      "defaultValue": 4,
      "description": "Max ratio for rare large rooms",
      "label": "大房间倍数上限",
      "mode": "parameter"
    },
    {
      "name": "corridorWidthMin",
      "type": "number",
      "defaultValue": 2,
      "description": "Min corridor inner width",
      "label": "走廊最小宽度",
      "mode": "parameter"
    },
    {
      "name": "corridorWidthMax",
      "type": "number",
      "defaultValue": 4,
      "description": "Max corridor inner width",
      "label": "走廊最大宽度",
      "mode": "parameter"
    },
    {
      "name": "corridorLenMin",
      "type": "number",
      "defaultValue": 3,
      "description": "Min corridor inner length",
      "label": "走廊最小长度",
      "mode": "parameter"
    },
    {
      "name": "corridorLenMax",
      "type": "number",
      "defaultValue": 10,
      "description": "Max corridor inner length",
      "label": "走廊最大长度",
      "mode": "parameter"
    },
    {
      "name": "irregularProb",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Probability of L-shaped rooms (0-1)",
      "label": "不规则房间概率",
      "mode": "parameter"
    },
    {
      "name": "silhouetteRMax",
      "type": "number",
      "defaultValue": 6,
      "description": "Max silhouette corners to room ratio",
      "label": "轮廓复杂度上限",
      "mode": "parameter"
    },
    {
      "name": "maxAttempts",
      "type": "number",
      "defaultValue": 40,
      "description": "Max placement attempts per room",
      "label": "单房间最大尝试",
      "mode": "parameter"
    },
    {
      "name": "roomMinDim",
      "type": "number",
      "defaultValue": 4,
      "description": "Min room inner dimension",
      "label": "房间最小尺寸",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses timestamp",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Grid with all rooms and corridors",
      "label": "输出网格"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "All room data including corridors",
      "label": "房间列表"
    },
    {
      "name": "connectionList",
      "type": "array",
      "description": "Room connections with shared wall cells",
      "label": "连接列表"
    },
    {
      "name": "nextRoomId",
      "type": "number",
      "description": "Next available room ID",
      "label": "下一个ID"
    }
  ],
  "deterministic": true
})
