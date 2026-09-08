// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorInit",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_init",
  "description": "Creates grid and places the initial square room with wall outline.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 300,
      "description": "Grid width in cells",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 220,
      "description": "Grid height in cells",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "roomMinSize",
      "type": "number",
      "defaultValue": 10,
      "description": "Min inner dimension of initial room",
      "label": "房间最小内径",
      "mode": "parameter"
    },
    {
      "name": "roomMaxSize",
      "type": "number",
      "defaultValue": 20,
      "description": "Max inner dimension of initial room",
      "label": "房间最大内径",
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
      "description": "Grid with initial room (0=void,1=wall,2=room)",
      "label": "输出网格"
    },
    {
      "name": "roomList",
      "type": "array",
      "description": "Room data array",
      "label": "房间列表"
    },
    {
      "name": "nextRoomId",
      "type": "number",
      "description": "Next available room ID",
      "label": "下一个房间ID"
    }
  ],
  "deterministic": true
})
