// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "flowField",
  "contractVersion": "1.0.0",
  "opId": "flow_field",
  "description": "Builds a cost map and direction field toward one or more targets. Each cell indicates which neighbor leads to the closest target—core data for RTS group pathfinding and AI navigation.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Cells equal to obstacleValue are walls; other cell values act as traversal cost weights.",
      "label": "可通行网格"
    },
    {
      "name": "targets",
      "type": "number",
      "defaultValue": [],
      "description": "Target coordinates [[x,y], ...]. All targets share one field; every cell flows toward the closest target (rank=2; legacy string also accepted).",
      "label": "目标点",
      "mode": "parameter"
    },
    {
      "name": "obstacleValue",
      "type": "number",
      "defaultValue": 0,
      "description": "Cells equal to this value are walls.",
      "label": "障碍值",
      "mode": "parameter"
    },
    {
      "name": "diagonal",
      "type": "boolean",
      "defaultValue": true,
      "description": "Allow 8-directional movement.",
      "label": "允许对角",
      "mode": "parameter"
    },
    {
      "name": "useCellWeight",
      "type": "boolean",
      "defaultValue": false,
      "description": "If true, use grid values as traversal cost; otherwise all passable cells cost 1.",
      "label": "使用格子权重",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "costGrid",
      "type": "grid",
      "description": "Shortest cost from each cell to its nearest target. Unreachable = -1.",
      "label": "代价图"
    },
    {
      "name": "directionGrid",
      "type": "grid",
      "description": "Per-cell direction code 1~8 toward the closest target (0 = at target or unreachable).",
      "label": "方向图"
    },
    {
      "name": "vectorField",
      "type": "number",
      "description": "3D array [h][w][2] of [vx,vy] unit vectors per cell; target/unreachable cells are [0,0] (rank=3: H × W × [vx,vy]).",
      "label": "向量场"
    }
  ],
  "deterministic": true
})
