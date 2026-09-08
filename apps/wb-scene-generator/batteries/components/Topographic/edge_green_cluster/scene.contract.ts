// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "edgeGreenCluster",
  "contractVersion": "1.0.0",
  "opId": "edge_green_cluster",
  "description": "Generate irregularly shaped green clusters along the edge of a target region (targetValue mask): seeds are sampled along the region's outer contour, and each grows an organic blob inward, hugging the inner edge. Controls cluster count, size, size variance, and shape irregularity.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single 2D grid (grid[y][x]); clusters are generated along the edge of its targetValue region. The engine fans out a DataTree of grids one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "targetValue",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Mask value of the region whose edge gets clusters.",
      "label": "目标区域值",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "defaultValue": 12,
      "description": "Number of clusters along the edge (evenly spaced along the contour with jitter).",
      "label": "簇数量",
      "mode": "parameter"
    },
    {
      "name": "clusterSize",
      "type": "number",
      "access": "item",
      "defaultValue": 18,
      "description": "Average cell count per cluster (varied by sizeVariance).",
      "label": "簇大小",
      "mode": "parameter"
    },
    {
      "name": "sizeVariance",
      "type": "number",
      "access": "item",
      "defaultValue": 0.4,
      "description": "Random size variation 0~1; 0 = uniform, 1 = ±100%.",
      "label": "大小方差",
      "mode": "parameter"
    },
    {
      "name": "irregularity",
      "type": "number",
      "access": "item",
      "defaultValue": 0.6,
      "description": "Shape irregularity 0~1; 0 = rounder, 1 = very ragged with tendrils.",
      "label": "形状破碎度",
      "mode": "parameter"
    },
    {
      "name": "outputValue",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Grid value written for cluster cells (background is 0).",
      "label": "输出码值",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Cluster mask grid with the same shape as the input (background 0, clusters = outputValue); feed into grid2node.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
