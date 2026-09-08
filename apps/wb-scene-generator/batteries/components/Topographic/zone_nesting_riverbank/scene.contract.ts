// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "zoneNestingRiverbank",
  "contractVersion": "1.0.0",
  "opId": "zone_nesting_riverbank",
  "description": "Riverbank variant of zone nesting: a low-frequency noise field drives the erosion depth per boundary segment — deep where the noise is high (wide cut-in), shallow where it is low (narrow) — so the inner boundary fluctuates like a natural riverbank instead of paralleling the outer contour as a uniform offset.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D grid (grid[y][x]); its target region is eroded with variable riverbank depth then spline-smoothed. The engine fans out a DataTree of grids one-by-one.",
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
      "defaultValue": 54,
      "description": "Mean erosion-depth fraction of the inner boundary. If >1, percent 0–100 (default 54); if ≤1, normalized 0–1. Depth fluctuates around this mean by 'waviness'.",
      "label": "平均侵蚀强度",
      "mode": "parameter"
    },
    {
      "name": "maxDepth",
      "type": "number",
      "access": "item",
      "defaultValue": 16,
      "description": "Maximum erosion depth in cells. Depth field = clamp(strength ± waviness, 0..1) × this value, capping how far the riverbank can cut in.",
      "label": "最大侵蚀深度",
      "mode": "parameter"
    },
    {
      "name": "waviness",
      "type": "number",
      "access": "item",
      "defaultValue": 0.8,
      "description": "Amplitude of the depth fluctuation: 0 ≈ uniform offset, larger = more uneven (wide/narrow). Recommended 0.5–1.2.",
      "label": "波动幅度",
      "mode": "parameter"
    },
    {
      "name": "featureScale",
      "type": "number",
      "access": "item",
      "defaultValue": 0.06,
      "description": "Spatial frequency of the noise field; smaller = longer waves (large bays), larger = finer. Recommended 0.03–0.12.",
      "label": "波动频率",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Seed for the erosion depth field; 0 uses timestamp.",
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
      "description": "A single grid after riverbank variable-depth erosion and spline; with a grid-list input the engine emits one per branch as a DataTree.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
