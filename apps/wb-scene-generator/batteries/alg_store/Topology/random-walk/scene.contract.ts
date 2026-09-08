// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "randomWalk",
  "contractVersion": "1.2.0",
  "opId": "random_walk",
  "description": "Generates a random walk path within a grid mask, supporting variable path width, multiple width decay modes, and configurable walk speed.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid mask; the walker moves only within non-zero cells.",
      "label": "输入网格"
    },
    {
      "name": "steps",
      "type": "number",
      "defaultValue": 500,
      "description": "Total number of walk steps; larger values cover more area.",
      "label": "步数",
      "mode": "parameter"
    },
    {
      "name": "startX",
      "type": "number",
      "defaultValue": -1,
      "description": "Start X coordinate; -1 = random position within the mask.",
      "label": "起始X",
      "mode": "parameter"
    },
    {
      "name": "startY",
      "type": "number",
      "defaultValue": -1,
      "description": "Start Y coordinate; -1 = random position within the mask.",
      "label": "起始Y",
      "mode": "parameter"
    },
    {
      "name": "pathWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Path diameter in pixels; minimum 1.",
      "label": "路径宽度",
      "mode": "parameter"
    },
    {
      "name": "widthDecay",
      "type": "string",
      "defaultValue": "none",
      "description": "Width decay mode: none, linear, exponential, sine (±50% oscillation), or random (±50% random).",
      "label": "宽度衰减",
      "options": [
        "none",
        "linear",
        "exponential",
        "sine",
        "random"
      ],
      "mode": "parameter"
    },
    {
      "name": "speed",
      "type": "number",
      "defaultValue": 2,
      "description": "Number of cells moved per step; larger values produce more spread-out paths.",
      "label": "行走速度",
      "mode": "parameter"
    },
    {
      "name": "stopAtBoundary",
      "type": "boolean",
      "defaultValue": true,
      "description": "Stop walking immediately when hitting mask boundary or grid edge; if false, change direction and continue.",
      "label": "触边停止",
      "mode": "parameter"
    },
    {
      "name": "dirBias",
      "type": "string",
      "defaultValue": "1,1,1,1,1,1,1,1",
      "description": "Walk probability weights for 8 directions (E,NE,N,NW,W,SW,S,SE), comma-separated, 0~1 each, auto-normalized internally.",
      "label": "方向偏好",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the default seed.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid with path cells set to 1 and all others 0.",
      "label": "路径网格"
    }
  ],
  "deterministic": true
})
