// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorVerify",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_verify",
  "description": "Verifies all rooms are reachable from initial room; repairs disconnected rooms.",
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
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Repaired grid",
      "label": "输出网格"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "Possibly with repair corridors",
      "label": "房间列表"
    },
    {
      "name": "connectionList",
      "type": "array",
      "description": "With repair connections",
      "label": "连接列表"
    }
  ],
  "deterministic": true
})
