// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPointsCenterScatter",
  "contractVersion": "1.0.0",
  "opId": "alg_points_center_scatter",
  "description": "Samples count decoration locations within a circular scatterRadius around a point2d center on valid region cells; BFS-snaps the center to the nearest valid cell when outside. Outputs a points list (one single-cell 0/1 grid per sample), matching alg_field2points. Algorithm from components/decoration/precise_decoration_scatter.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Parent region mask; sampling occurs only on valid cells.",
      "label": "父区域"
    },
    {
      "name": "point",
      "type": "point2d",
      "access": "item",
      "required": false,
      "description": "Scatter center point2d; x→column, y→row. Random valid cell if omitted.",
      "label": "兴趣点"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 5,
      "description": "Target number of decoration sample points.",
      "label": "采样数量",
      "mode": "parameter"
    },
    {
      "name": "scatterRadius",
      "type": "number",
      "defaultValue": 12,
      "description": "Circular scatter radius in cells around the snapped center.",
      "label": "播撒半径",
      "mode": "parameter"
    },
    {
      "name": "algorithm",
      "type": "string",
      "defaultValue": "random",
      "description": "random, cluster, ring, poisson, or noise.",
      "label": "采样算法",
      "options": [
        "random",
        "cluster",
        "ring",
        "poisson",
        "noise"
      ],
      "mode": "parameter"
    },
    {
      "name": "targetValue",
      "type": "number",
      "defaultValue": 0,
      "description": "0 = any non-zero valid cell; non-zero requires exact mask value.",
      "label": "目标区域值",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "points",
      "type": "grid",
      "access": "list",
      "description": "One single-cell 0/1 grid per sampled cell; same list contract as alg_field2points.",
      "label": "采样点列表"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of points actually sampled (may be less than count).",
      "label": "实际采样数"
    },
    {
      "name": "snappedCenter",
      "type": "array",
      "access": "item",
      "description": "BFS-snapped center coordinate [x, y].",
      "label": "吸附中心"
    }
  ],
  "deterministic": true
})
