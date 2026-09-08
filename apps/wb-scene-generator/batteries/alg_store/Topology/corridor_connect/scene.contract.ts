// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "corridorConnect",
  "contractVersion": "1.0.0",
  "opId": "corridor_connect",
  "description": "Connect rooms in an existing grid via MST with L-shaped or Z-shaped corridors; optional extra edges create loops.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid: 0=empty, positive integers=room IDs.",
      "label": "房间网格"
    },
    {
      "name": "corridorWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Corridor width in cells (1~5).",
      "label": "走廊宽度",
      "mode": "parameter"
    },
    {
      "name": "corridorValue",
      "type": "number",
      "defaultValue": -1,
      "description": "Value to fill corridor cells; -1 uses a special marker value.",
      "label": "走廊填充值",
      "mode": "parameter"
    },
    {
      "name": "extraEdgeRatio",
      "type": "number",
      "defaultValue": 0.15,
      "description": "Fraction of extra edges beyond MST (0~1) to create loops.",
      "label": "额外连线比例",
      "mode": "parameter"
    },
    {
      "name": "shape",
      "type": "string",
      "defaultValue": "random",
      "description": "Corridor shape: L, Z, or random mix.",
      "label": "走廊形状",
      "options": [
        "L",
        "Z",
        "random"
      ],
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Full grid containing rooms and corridors.",
      "label": "连接后网格"
    },
    {
      "name": "corridorGrid",
      "type": "grid",
      "description": "Corridor-only grid: 0=non-corridor, 1=corridor.",
      "label": "走廊网格"
    },
    {
      "name": "connections",
      "type": "dict",
      "description": "Array of room connection pairs [{from, to}] (rank=1).",
      "label": "连接列表"
    },
    {
      "name": "numConnections",
      "type": "number",
      "description": "Total number of corridor connections.",
      "label": "连接数"
    }
  ],
  "deterministic": true
})
