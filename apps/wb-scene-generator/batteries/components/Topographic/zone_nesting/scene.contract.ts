// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "zoneNesting",
  "contractVersion": "2.0.0",
  "opId": "zone_nesting",
  "description": "Multi-layer erosion of a target region for organic shapes, with optional closed-loop spline smoothing of the outer contour (Bezier, cubic spline, moving average, Gaussian, polyline perturbation).",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D grid (grid[y][x]); its target region is eroded then spline-smoothed. The engine fans out a DataTree of grids one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "targetValue",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Mask value of the target region.",
      "label": "目标区域值",
      "mode": "parameter"
    },
    {
      "name": "erosionStrength",
      "type": "number",
      "access": "item",
      "defaultValue": 20,
      "description": "If >1, percent 0–100 (default 20); if ≤1, legacy normalized 0–1.",
      "label": "退格程度",
      "mode": "parameter"
    },
    {
      "name": "layers",
      "type": "number",
      "access": "item",
      "defaultValue": 12,
      "description": "Number of erosion iterations.",
      "label": "侵蚀层数",
      "mode": "parameter"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "cellular",
      "description": "Erosion: cellular, noise, random_walk.",
      "label": "侵蚀算法",
      "options": [
        "cellular",
        "noise",
        "random_walk"
      ],
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Seed for erosion RNG; 0 uses timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "splineAlgorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "gaussian",
      "description": "Closed-loop spline algorithm (same family as edge_spline).",
      "label": "样条算法",
      "options": [
        "bezier",
        "cubic_spline",
        "moving_avg",
        "gaussian",
        "polyline_perturb"
      ],
      "mode": "parameter"
    },
    {
      "name": "splineSmoothness",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "Spline intensity (1–20), same as edge_spline smoothness.",
      "label": "样条平滑强度",
      "mode": "parameter"
    },
    {
      "name": "splineSeed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Seed for polyline_perturb; 0 uses timestamp.",
      "label": "样条随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "A single grid after erosion and spline; with a grid-list input the engine emits one per branch as a DataTree.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
