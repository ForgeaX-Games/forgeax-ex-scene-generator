// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "riverBridge",
  "contractVersion": "2.0.0",
  "opId": "river_bridge",
  "description": "Analyzes the local river flow direction in a single grid and generates a bridge mask perpendicular to it. Straight mode uses projection; zigzag mode uses Shisen-Sho pathfinding (≤2 H/V turns) connecting opposite bank endpoints. Input/output are single grids (item); the engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D grid (grid[y][x]); non-zero cells define the river region and flow is auto-detected. The engine fans out a DataTree of grids one-by-one.",
      "label": "河流网格"
    },
    {
      "name": "width",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Bridge width in cells.",
      "label": "桥宽（格）",
      "mode": "parameter"
    },
    {
      "name": "position",
      "type": "number",
      "access": "item",
      "defaultValue": 0.5,
      "description": "0.0 to 1.0, relative position along the river's main axis. 0=start, 1=end, 0.5=center.",
      "label": "桥位置",
      "mode": "parameter"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "straight",
      "description": "straight = straight perpendicular bridge; zigzag = H/V polyline bridge (Z or L shape).",
      "label": "桥形算法",
      "options": [
        "straight",
        "zigzag"
      ],
      "mode": "parameter"
    },
    {
      "name": "extendToLand",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "When enabled, the bridge extends 1 cell beyond each river bank onto land, connecting both shores.",
      "label": "延伸到陆地",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Bridge mask grid; bridge cells = 1, others = 0. With a grid-list input the engine emits one per branch as a DataTree.",
      "label": "桥掩码"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list, always [{id: 1, name: '桥', type: 'tile'}].",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
