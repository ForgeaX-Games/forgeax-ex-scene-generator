// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorDeform",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_deform",
  "description": "Deforms rectangular rooms into irregular shapes (L/T/U) by extending into adjacent void pockets.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Grid with all rooms",
      "label": "输入网格"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "Room data",
      "label": "房间列表"
    },
    {
      "name": "connectionList",
      "type": "array",
      "description": "Room connections",
      "label": "连接列表"
    },
    {
      "name": "deformProb",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Probability of deforming each room (0-1)",
      "label": "变形概率",
      "mode": "parameter"
    },
    {
      "name": "maxExtPerRoom",
      "type": "number",
      "defaultValue": 2,
      "description": "Max extensions per room",
      "label": "每房间最大扩展数",
      "mode": "parameter"
    },
    {
      "name": "minExtDim",
      "type": "number",
      "defaultValue": 2,
      "description": "Min inner dimension of extension",
      "label": "最小扩展尺寸",
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
      "description": "Grid with deformed rooms",
      "label": "输出网格"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "Updated room data",
      "label": "房间列表"
    },
    {
      "name": "connectionList",
      "type": "array",
      "description": "Updated connections",
      "label": "连接列表"
    }
  ],
  "deterministic": true
})
