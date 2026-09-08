// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cliffPlatformGen",
  "contractVersion": "2.0.0",
  "opId": "cliff_platform_gen",
  "description": "Explicit circular platform placement: places a specified number of independent organic platforms per tier, with precise control over patch count, area ratio, and edge bias, generating truly multi-patch, organic cliff terrain.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single input rectangular grid; non-zero cells define terrain bounds. Grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "tierCount",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Total terrain tiers including base tier; recommended 3-5.",
      "label": "地形层数",
      "mode": "parameter"
    },
    {
      "name": "tierAreaRatios",
      "type": "string",
      "access": "item",
      "defaultValue": "",
      "description": "Area fractions from highest to second-lowest tier; JSON array of length tierCount-1. Base tier fills the rest.",
      "label": "各层面积占比",
      "mode": "parameter"
    },
    {
      "name": "tierPatchCounts",
      "type": "string",
      "access": "item",
      "defaultValue": "",
      "description": "Number of independent patches per tier, from highest to second-lowest; JSON array of length tierCount-1.",
      "label": "各层平台数量",
      "mode": "parameter"
    },
    {
      "name": "patchEdgeDetail",
      "type": "number",
      "access": "item",
      "defaultValue": 2.5,
      "description": "Noise frequency for patch edge shape; 1=very smooth, 3=moderate organic, 6=fine-grained detail. Recommended: 1.5-4.",
      "label": "边缘细节频率",
      "mode": "parameter"
    },
    {
      "name": "patchRoundness",
      "type": "number",
      "access": "item",
      "defaultValue": 0.65,
      "description": "Roundness of platform shapes; 0=highly irregular, 1=near-perfect circles. Recommended: 0.5-0.8.",
      "label": "平台圆度",
      "mode": "parameter"
    },
    {
      "name": "edgeBias",
      "type": "number",
      "access": "item",
      "defaultValue": 0.3,
      "description": "Probability of placing patch centers near map edges; 0=interior only, 1=all at edges. Edge patches merge with the boundary creating natural cliff walls. Recommended: 0.2-0.5.",
      "label": "贴边程度",
      "mode": "parameter"
    },
    {
      "name": "patchSizeVariation",
      "type": "number",
      "access": "item",
      "defaultValue": 0.45,
      "description": "Size variation among patches within same tier; 0=all same size, 1=high variation. Recommended: 0.3-0.6.",
      "label": "平台大小变化",
      "mode": "parameter"
    },
    {
      "name": "smoothPasses",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Smoothing iterations (majority vote filter); 0=none, 2=moderate (default), 3-4=strong. More passes round boundaries but may merge small patches.",
      "label": "平滑次数",
      "mode": "parameter"
    },
    {
      "name": "smoothRadius",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Neighborhood radius for majority voting; 1=3×3, 2=5×5 (default), 3=7×7. Larger values give smoother edges but shift boundaries.",
      "label": "平滑半径",
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
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single layered terrain grid: 1=highest, N=lowest, 0=outside. Each tier has multiple independent patches.",
      "label": "地形分层网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list [{id, name, type}] for each tier; type is always \"tile\".",
      "label": "分区名称清单"
    }
  ],
  "deterministic": true
})
