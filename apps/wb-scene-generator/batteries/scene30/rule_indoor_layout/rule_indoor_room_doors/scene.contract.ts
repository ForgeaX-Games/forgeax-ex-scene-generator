// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorRoomDoors",
  "contractVersion": "1.2.0",
  "opId": "rule_indoor_room_doors",
  "description": "Opens door gaps on walls between rooms and corridors, ensuring all rooms are connected.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Grid: 0=wall, 1=corridor, 10+=room IDs.",
      "label": "输入网格"
    },
    {
      "name": "doorWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Door opening width in cells (2-4).",
      "label": "门洞宽度",
      "mode": "parameter"
    },
    {
      "name": "maxDoorsPerRoom",
      "type": "number",
      "defaultValue": 4,
      "description": "Maximum number of doors per room (extras are probability-gated).",
      "label": "每房间最多门数",
      "mode": "parameter"
    },
    {
      "name": "doorProbability",
      "type": "number",
      "defaultValue": 0.5,
      "description": "First door is always opened; this probability controls extra doors (0=one door only, 1=open all up to max).",
      "label": "开门概率",
      "mode": "parameter"
    },
    {
      "name": "doorValue",
      "type": "number",
      "defaultValue": 2,
      "description": "Cell value written into door openings; must differ from corridor (1). Default 2.",
      "label": "门洞标记值",
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
      "description": "Grid with door openings; corridor=1, door=doorValue(default 2), wall=0, rooms>=10.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
