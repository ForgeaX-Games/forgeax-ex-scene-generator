// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorDoors",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_doors",
  "description": "Carves doors through shared walls between connected rooms in a completed layout.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Completed layout grid",
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
      "name": "doorWidthMin",
      "type": "number",
      "defaultValue": 2,
      "description": "Minimum door width in cells",
      "label": "最小门宽",
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
      "description": "Final grid with doors",
      "label": "输出网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Grid value to name mapping",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
