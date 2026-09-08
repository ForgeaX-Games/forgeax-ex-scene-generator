// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionAreaPartition",
  "contractVersion": "1.1.0",
  "opId": "alg_region_area_partition",
  "description": "Partitions a parent region mask from a point2d center list and area weights. Quota-aware Voronoi + Lloyd relaxation + optional boundary post-processing. Outputs partition[] ordered by input points.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Parent region mask; non-zero cells are partitionable.",
      "label": "父区域"
    },
    {
      "name": "points",
      "type": "point2d",
      "access": "list",
      "required": true,
      "description": "List of point2d centers; x→column, y→row; one zone per point.",
      "label": "中心点"
    },
    {
      "name": "areas",
      "type": "number",
      "access": "list",
      "description": "Per-zone area weights (relative ratios), same length as points.",
      "label": "面积列表",
      "mode": "parameter"
    },
    {
      "name": "centers",
      "type": "array",
      "description": "Legacy: coordinate arrays. Prefer points port.",
      "label": "中心点数组（兼容）"
    },
    {
      "name": "positions",
      "type": "array",
      "description": "Legacy: 1-9 grid slot positions. Prefer points port.",
      "label": "九宫格方位（兼容）"
    },
    {
      "name": "boundaryStyle",
      "type": "string",
      "access": "item",
      "defaultValue": "organic",
      "description": "Boundary style: organic, smooth, rectilinear, or voronoi.",
      "label": "边界风格",
      "options": [
        "organic",
        "smooth",
        "rectilinear",
        "voronoi"
      ],
      "mode": "parameter"
    },
    {
      "name": "relaxIterations",
      "type": "number",
      "access": "item",
      "defaultValue": 6,
      "description": "Lloyd relaxation iterations; recommended 3-8.",
      "label": "松弛迭代",
      "mode": "parameter"
    },
    {
      "name": "smoothIterations",
      "type": "number",
      "access": "item",
      "defaultValue": 10,
      "description": "CA smoothing iterations for organic/smooth styles.",
      "label": "平滑迭代",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "stretch",
      "type": "point2d",
      "access": "list",
      "description": "Per-zone anisotropy (x→horizontal, y→vertical) scale, same length as points; 1=circular, >1 stretches along that axis, clamped to 0.25-4, defaults to 1.",
      "label": "拉伸系数"
    },
    {
      "name": "edgeNoise",
      "type": "number",
      "access": "item",
      "defaultValue": 2.5,
      "description": "Low-frequency boundary warp amplitude in pixels; adds natural meander and reduces sharp multi-way vertices. 0 disables it.",
      "label": "边界扰动",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per zone, ordered by center points.",
      "label": "分区列表"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of zones produced.",
      "label": "分区数"
    }
  ],
  "deterministic": true
})
