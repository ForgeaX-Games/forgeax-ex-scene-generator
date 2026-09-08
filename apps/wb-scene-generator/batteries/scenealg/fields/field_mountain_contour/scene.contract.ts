// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algFieldMountainContour",
  "contractVersion": "1.0.0",
  "opId": "alg_field_mountain_contour",
  "description": "Generates a [0,1] mountain height scalar field on valid (non-zero) cells of the input region: domain-warped FBM base terrain + multi-peak Gaussian boosts + equal-area quantile remap, extracted from the height-field core of scene30/mountain/mountain_contour_generate. Invalid cells output 0.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) parent region mask; height is generated only on non-zero valid cells.",
      "label": "父区域"
    },
    {
      "name": "peakCount",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of peaks; each adds a Gaussian boost into the noise terrain.",
      "label": "山头数量",
      "mode": "parameter"
    },
    {
      "name": "peakRadius",
      "type": "number",
      "defaultValue": 0.14,
      "description": "Gaussian peak influence radius in normalized coords (0-1).",
      "label": "山头半径",
      "mode": "parameter"
    },
    {
      "name": "peakStrength",
      "type": "number",
      "defaultValue": 1.2,
      "description": "Peak boost intensity; higher values make peaks more prominent.",
      "label": "山头强度",
      "mode": "parameter"
    },
    {
      "name": "noiseScale",
      "type": "number",
      "defaultValue": 2.5,
      "description": "FBM base noise frequency scale; higher = busier terrain.",
      "label": "噪声缩放",
      "mode": "parameter"
    },
    {
      "name": "warpStrength",
      "type": "number",
      "defaultValue": 1.2,
      "description": "Domain warp strength: 0=rounder, 1.2=organic flow.",
      "label": "域扭曲强度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current time.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "edgeFalloffCells",
      "type": "number",
      "defaultValue": 6,
      "description": "Soft rise band (cells) from the region perimeter inward. Prevents hard rectangular truncation at the mask edge; 0=off.",
      "label": "边缘衰减格数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "field",
      "type": "grid",
      "access": "item",
      "description": "A [0,1] scalar height field matching the input shape; valid cells hold normalized height, invalid cells are 0.",
      "label": "高度场"
    }
  ],
  "deterministic": true
})
