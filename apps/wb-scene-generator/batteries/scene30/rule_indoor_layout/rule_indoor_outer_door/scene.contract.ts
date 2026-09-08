// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorOuterDoor",
  "contractVersion": "1.0.0",
  "opId": "rule_indoor_outer_door",
  "description": "Opens doors in the building outer wall where corridors meet the perimeter, connecting interior corridors to the exterior.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Processed indoor grid: 0=wall/exterior, 1=corridor, 10+=rooms.",
      "label": "输入网格"
    },
    {
      "name": "footprintGrid",
      "type": "grid",
      "description": "Original building footprint (non-zero = interior), distinguishes outer wall from exterior.",
      "label": "建筑轮廓网格"
    },
    {
      "name": "doorWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Outer wall door width in cells.",
      "label": "门洞宽度",
      "mode": "parameter"
    },
    {
      "name": "maxDoors",
      "type": "number",
      "defaultValue": 8,
      "description": "Maximum number of outer wall doors.",
      "label": "最多门数",
      "mode": "parameter"
    },
    {
      "name": "maxWallDepth",
      "type": "number",
      "defaultValue": 6,
      "description": "Maximum wall thickness to search through from corridor to exterior.",
      "label": "最大墙厚搜索",
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
      "description": "Grid with outer wall doors opened.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
