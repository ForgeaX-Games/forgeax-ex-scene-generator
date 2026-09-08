// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorContourCorridor",
  "contractVersion": "1.1.0",
  "opId": "rule_indoor_contour_corridor",
  "description": "Generates N concentric corridor rings by inward contour offset, supporting L/U/T and irregular shapes.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Non-zero cells define building interior, supports irregular shapes.",
      "label": "输入网格"
    },
    {
      "name": "firstRingOffset",
      "type": "number",
      "defaultValue": 12,
      "description": "First corridor ring inward offset from outer wall (10-15).",
      "label": "第一圈偏移",
      "mode": "parameter"
    },
    {
      "name": "ringSpacing",
      "type": "number",
      "defaultValue": 22,
      "description": "Spacing between adjacent corridor rings (20-30, rooms in between).",
      "label": "环间距",
      "mode": "parameter"
    },
    {
      "name": "corridorWidth",
      "type": "number",
      "defaultValue": 5,
      "description": "Corridor width in cells (4-6).",
      "label": "走廊宽度",
      "mode": "parameter"
    },
    {
      "name": "wallThickness",
      "type": "number",
      "defaultValue": 2,
      "description": "Outer wall thickness in cells.",
      "label": "外墙厚度",
      "mode": "parameter"
    },
    {
      "name": "maxRings",
      "type": "number",
      "defaultValue": 5,
      "description": "Maximum number of corridor rings (auto-clipped by available space).",
      "label": "最大环数",
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
      "description": "0=wall, 1=corridor, 2=room zone.",
      "label": "输出网格"
    },
    {
      "name": "ringCount",
      "type": "number",
      "description": "Number of corridor rings actually created.",
      "label": "走廊环数"
    }
  ],
  "deterministic": true
})
