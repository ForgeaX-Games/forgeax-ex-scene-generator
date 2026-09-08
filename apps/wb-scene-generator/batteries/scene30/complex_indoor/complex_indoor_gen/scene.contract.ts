// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorGen",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_gen",
  "description": "Generates complex multi-room indoor layouts via iterative growth (corridor link / direct attach) with contour complexity control and connectivity validation.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 200,
      "description": "Total grid width in cells.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 150,
      "description": "Total grid height in cells.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "targetRoomCount",
      "type": "number",
      "defaultValue": 25,
      "description": "Target number of rooms excluding corridors; actual count may be lower due to space constraints.",
      "label": "目标房间数",
      "mode": "parameter"
    },
    {
      "name": "initRoomMinSize",
      "type": "number",
      "defaultValue": 10,
      "description": "Minimum dimension of the initial room in cells.",
      "label": "初始房间最小尺寸",
      "mode": "parameter"
    },
    {
      "name": "initRoomMaxSize",
      "type": "number",
      "defaultValue": 18,
      "description": "Maximum dimension of the initial room in cells.",
      "label": "初始房间最大尺寸",
      "mode": "parameter"
    },
    {
      "name": "corridorProb",
      "type": "number",
      "defaultValue": 0.4,
      "description": "Probability of using corridor link per growth step (0 to 1); remainder uses direct attach.",
      "label": "走廊概率",
      "mode": "parameter"
    },
    {
      "name": "corridorWidthMin",
      "type": "number",
      "defaultValue": 2,
      "description": "Minimum corridor width in cells (at least 2).",
      "label": "走廊最小宽度",
      "mode": "parameter"
    },
    {
      "name": "corridorWidthMax",
      "type": "number",
      "defaultValue": 6,
      "description": "Maximum corridor width in cells; clamped to edge length.",
      "label": "走廊最大宽度",
      "mode": "parameter"
    },
    {
      "name": "corridorLenMin",
      "type": "number",
      "defaultValue": 3,
      "description": "Minimum corridor length in cells.",
      "label": "走廊最小长度",
      "mode": "parameter"
    },
    {
      "name": "corridorLenMax",
      "type": "number",
      "defaultValue": 12,
      "description": "Maximum corridor length in cells.",
      "label": "走廊最大长度",
      "mode": "parameter"
    },
    {
      "name": "doorWidthMin",
      "type": "number",
      "defaultValue": 2,
      "description": "Minimum door width in cells (at least 2).",
      "label": "最小门宽",
      "mode": "parameter"
    },
    {
      "name": "roomMinDim",
      "type": "number",
      "defaultValue": 4,
      "description": "Minimum room dimension in cells.",
      "label": "房间最小尺寸",
      "mode": "parameter"
    },
    {
      "name": "silhouetteRMax",
      "type": "number",
      "defaultValue": 6,
      "description": "Maximum ratio of silhouette corners to room count; higher values allow more complex outlines (recommended 4 to 8).",
      "label": "轮廓复杂度上限",
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
      "description": "Output grid: 0=wall, 1=room, 2=corridor, 3=door.",
      "label": "布局网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Mapping of grid values to display names [{id, name}].",
      "label": "名称清单"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "Detailed info for all rooms and corridors [{id, x, y, w, h, area, isCorridor, parentId}].",
      "label": "房间列表"
    }
  ],
  "deterministic": true
})
