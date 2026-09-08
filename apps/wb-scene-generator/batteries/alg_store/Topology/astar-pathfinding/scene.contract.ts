// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "astarPathfinding",
  "contractVersion": "1.0.0",
  "opId": "astar_pathfinding",
  "description": "A* pathfinding on a binary grid, finds the shortest path from start to end. Supports 4-directional and 8-directional movement, outputs a 0/1 path grid.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Binary grid where 1 = passable road, 0 = impassable obstacle.",
      "label": "输入网格"
    },
    {
      "name": "start",
      "type": "number",
      "defaultValue": [],
      "description": "Start coordinate [x, y]; empty = random passable cell (rankAny=true; legacy string also accepted).",
      "label": "起点坐标",
      "mode": "parameter"
    },
    {
      "name": "end",
      "type": "number",
      "defaultValue": [],
      "description": "End coordinate [x, y]; empty = random passable cell (rankAny=true; legacy string also accepted).",
      "label": "终点坐标",
      "mode": "parameter"
    },
    {
      "name": "diagonal",
      "type": "boolean",
      "defaultValue": false,
      "description": "Allow 8-directional diagonal movement (default: 4-directional only).",
      "label": "允许对角移动",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed for choosing random start/end when not specified. 0 uses default seed.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid with path cells = 1, others = 0. All zeros if no path exists.",
      "label": "路径网格"
    }
  ],
  "deterministic": true
})
