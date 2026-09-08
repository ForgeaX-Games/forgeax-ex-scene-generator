// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorRoomSlice",
  "contractVersion": "1.0.0",
  "opId": "rule_indoor_room_slice",
  "description": "Recursively slices room zones perpendicular to their long axis, assigning unique room IDs.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Grid: 0=exterior/wall, 1=corridor, 2=room zone.",
      "label": "输入网格"
    },
    {
      "name": "minRoomSize",
      "type": "number",
      "defaultValue": 8,
      "description": "Minimum room dimension in cells.",
      "label": "最小房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "maxRoomSize",
      "type": "number",
      "defaultValue": 25,
      "description": "Maximum room dimension before further slicing.",
      "label": "最大房间尺寸",
      "mode": "parameter"
    },
    {
      "name": "wallThickness",
      "type": "number",
      "defaultValue": 1,
      "description": "Interior wall thickness (1-2 cells).",
      "label": "内墙厚度",
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
      "description": "0=wall, 1=corridor, 10+=room IDs.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
