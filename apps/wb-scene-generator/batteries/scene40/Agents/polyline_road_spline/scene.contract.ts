// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "polylineRoadSpline",
  "contractVersion": "1.0.0",
  "opId": "polyline_road_spline",
  "description": "Interpolate open control points with a centripetal cubic spline and rasterize a road mask. The curve passes through every point. Wire points from mergePoints / manualPoint.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Base grid that determines mask shape. Non-zero cells are the pavable footprint when clipToFootprint is on.",
      "label": "基准网格"
    },
    {
      "name": "points",
      "type": "point2d",
      "access": "list",
      "required": true,
      "description": "Road control points as one list. At least 2; the road passes through each in order.",
      "label": "控制点"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Road width in grid cells (circular brush diameter).",
      "label": "道路宽度",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "tension",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Tension [0,1]: 0 keeps full spline curvature, 1 tightens into straight segments.",
      "label": "曲线张力",
      "mode": "parameter"
    },
    {
      "name": "roundness",
      "type": "number",
      "access": "item",
      "defaultValue": 1.3,
      "description": "Knot tangent gain [0,2.5]. 1 is the plain natural spline.",
      "label": "圆滑增益",
      "mode": "parameter"
    },
    {
      "name": "samplesPerSegment",
      "type": "number",
      "access": "item",
      "defaultValue": 24,
      "description": "Spline samples between adjacent control points.",
      "label": "每段采样数",
      "mode": "parameter"
    },
    {
      "name": "clipToFootprint",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "When on, paint only on non-zero cells of inputGrid.",
      "label": "裁剪到足迹",
      "mode": "parameter"
    },
    {
      "name": "reinforceJoints",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "Fill notches at direction-change steps so joints match road width.",
      "label": "接缝加固",
      "mode": "parameter"
    },
    {
      "name": "fillValue",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Integer written to road cells; others stay 0.",
      "label": "道路填充值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Road mask matching inputGrid shape: road cells are fillValue, others 0.",
      "label": "道路掩码"
    },
    {
      "name": "cellCount",
      "type": "number",
      "access": "item",
      "description": "Number of filled cells.",
      "label": "道路格数"
    }
  ],
  "deterministic": true
})
