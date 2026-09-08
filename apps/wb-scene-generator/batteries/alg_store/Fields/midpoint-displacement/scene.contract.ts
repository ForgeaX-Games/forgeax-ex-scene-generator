// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "midpointDisplacement",
  "contractVersion": "1.0.0",
  "opId": "midpoint_displacement",
  "description": "Midpoint Displacement algorithm for generating fractal terrain heightmaps, outputs a 0~1 normalized grid.",
  "inputs": [
    {
      "name": "power",
      "type": "number",
      "defaultValue": 7,
      "description": "Grid side length = 2^power + 1 (e.g. 7 → 129×129, 8 → 257×257).",
      "label": "网格幂次",
      "mode": "parameter"
    },
    {
      "name": "roughness",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Terrain roughness (0~1); higher = more rugged, lower = smoother.",
      "label": "粗糙度",
      "mode": "parameter"
    },
    {
      "name": "initHeight",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Initial height value for the four corners (0~1).",
      "label": "初始高度",
      "mode": "parameter"
    },
    {
      "name": "spread",
      "type": "number",
      "defaultValue": 1,
      "description": "Initial random displacement amplitude; decays by roughness each iteration.",
      "label": "扰动幅度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different terrains.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output heightmap grid, values normalized to 0~1 (continuous floats). Renderer auto-detects as continuous grid, displays with single color + alpha gradient.",
      "label": "地形网格"
    }
  ],
  "deterministic": true
})
