// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "mazeGeneration",
  "contractVersion": "1.0.0",
  "opId": "maze_generation",
  "description": "Generates a perfect maze using recursive backtracking (randomized DFS), with configurable maze size, wall and passage thickness, outputs a 0/1 grid.",
  "inputs": [
    {
      "name": "cols",
      "type": "number",
      "defaultValue": 24,
      "description": "Number of maze columns (passage cells); controls horizontal complexity. Output width = cols×(passageSize+wallSize)+wallSize.",
      "label": "列数",
      "mode": "parameter"
    },
    {
      "name": "rows",
      "type": "number",
      "defaultValue": 24,
      "description": "Number of maze rows (passage cells); controls vertical complexity. Output height = rows×(passageSize+wallSize)+wallSize.",
      "label": "行数",
      "mode": "parameter"
    },
    {
      "name": "wallSize",
      "type": "number",
      "defaultValue": 1,
      "description": "Wall thickness in pixels; minimum 1.",
      "label": "墙壁厚度",
      "mode": "parameter"
    },
    {
      "name": "passageSize",
      "type": "number",
      "defaultValue": 1,
      "description": "Passage width in pixels; minimum 1.",
      "label": "通道厚度",
      "mode": "parameter"
    },
    {
      "name": "entrance",
      "type": "boolean",
      "defaultValue": true,
      "description": "Whether to open entrance (top-left) and exit (bottom-right).",
      "label": "开放入口出口",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different mazes.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output maze grid; passage = 1, wall = 0.",
      "label": "迷宫网格"
    }
  ],
  "deterministic": true
})
