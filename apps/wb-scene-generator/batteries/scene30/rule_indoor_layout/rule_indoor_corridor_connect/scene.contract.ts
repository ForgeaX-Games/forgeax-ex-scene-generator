// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorCorridorConnect",
  "contractVersion": "1.3.0",
  "opId": "rule_indoor_corridor_connect",
  "description": "Extends connectors from inner rings outward through all rings to the outer wall, each with random width 2-6.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Grid: 0=wall, 1=corridor ring, 2=room zone.",
      "label": "输入网格"
    },
    {
      "name": "minWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Minimum connector corridor width.",
      "label": "最小连接宽度",
      "mode": "parameter"
    },
    {
      "name": "maxWidth",
      "type": "number",
      "defaultValue": 6,
      "description": "Maximum connector corridor width.",
      "label": "最大连接宽度",
      "mode": "parameter"
    },
    {
      "name": "connectorCount",
      "type": "number",
      "defaultValue": 16,
      "description": "Total number of connector corridors.",
      "label": "连接数量",
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
      "description": "Grid with corridor rings connected to outer wall.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
