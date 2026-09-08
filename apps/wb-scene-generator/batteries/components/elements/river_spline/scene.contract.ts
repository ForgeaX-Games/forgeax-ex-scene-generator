// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "riverSpline",
  "contractVersion": "3.0.0",
  "opId": "river_spline",
  "description": "Generates a natural river from control points via perturbation and five smoothing algorithms, then rasterizes it onto a single grid. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single 2D integer grid; the river mask will be overlaid onto it. The engine fans out a grid list one-by-one.",
      "label": "基准网格"
    },
    {
      "name": "points",
      "type": "array",
      "access": "item",
      "description": "River path control points in [[col,row],...] format, connected in order.",
      "label": "控制点"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "cubic_spline",
      "description": "Smoothing algorithm: noise, bezier, cubic_spline, moving_avg, or gaussian.",
      "label": "平滑算法",
      "options": [
        "noise",
        "bezier",
        "cubic_spline",
        "moving_avg",
        "gaussian"
      ],
      "mode": "parameter"
    },
    {
      "name": "riverWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "River width in grid cells; controls the rasterization brush diameter.",
      "label": "河流宽度",
      "mode": "parameter"
    },
    {
      "name": "numMidPoints",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Number of interior points perturbed along normals; more = more complex curve.",
      "label": "内部扰动点数",
      "mode": "parameter"
    },
    {
      "name": "offsetMin",
      "type": "number",
      "access": "item",
      "defaultValue": -30,
      "description": "Minimum normal offset for perturbation in grid cells.",
      "label": "法线偏移最小值",
      "mode": "parameter"
    },
    {
      "name": "offsetMax",
      "type": "number",
      "access": "item",
      "defaultValue": 30,
      "description": "Maximum normal offset for perturbation in grid cells.",
      "label": "法线偏移最大值",
      "mode": "parameter"
    },
    {
      "name": "segmentUniformity",
      "type": "number",
      "access": "item",
      "defaultValue": 0.5,
      "description": "Perturbation point distribution uniformity [0,1]. 1=evenly spaced, 0=random.",
      "label": "扰动均匀度",
      "mode": "parameter"
    },
    {
      "name": "windowSize",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "moving_avg only: sliding window size (odd number); larger = smoother.",
      "label": "窗口大小（移动平均）",
      "mode": "parameter"
    },
    {
      "name": "sigma",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "gaussian only: Gaussian kernel sigma; larger = smoother (suggested 0.5~5.0).",
      "label": "标准差（高斯）",
      "mode": "parameter"
    },
    {
      "name": "bezierDegree",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "bezier only: Bézier curve degree (1~6); 3 = cubic.",
      "label": "贝塞尔次数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed for perturbation; 0 = different each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single output grid with the river mask overlaid; river cells filled with max(input)+1.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
