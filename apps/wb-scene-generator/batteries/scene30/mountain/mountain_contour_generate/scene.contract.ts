// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "mountainContourGenerate",
  "contractVersion": "2.0.0",
  "opId": "mountain_contour_generate",
  "description": "Accepts an input mask grid and generates a height field via FBM noise + Gaussian peak boosts only for non-zero cells, outputting each contour level as a separate mask grid plus a continuous height field; zero cells remain 0 in all outputs.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input mask grid; contours are generated only for non-zero cells, zero cells remain 0 in all outputs.",
      "label": "输入网格"
    },
    {
      "name": "peakCount",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of peaks; each adds a Gaussian boost into the noise terrain, naturally forming saddles.",
      "label": "山头数量",
      "mode": "parameter"
    },
    {
      "name": "contourLevels",
      "type": "number",
      "defaultValue": 8,
      "description": "Number of contour levels, determines the length of the output grid list.",
      "label": "等高线层数",
      "mode": "parameter"
    },
    {
      "name": "peakRadius",
      "type": "number",
      "defaultValue": 0.14,
      "description": "Gaussian peak influence radius in normalized coords (0-1); larger = broader mountain.",
      "label": "山头半径",
      "mode": "parameter"
    },
    {
      "name": "peakStrength",
      "type": "number",
      "defaultValue": 0.9,
      "description": "Peak boost intensity; higher values make peaks more prominent with denser contours.",
      "label": "山头强度",
      "mode": "parameter"
    },
    {
      "name": "noiseScale",
      "type": "number",
      "defaultValue": 2.2,
      "description": "FBM base noise frequency scale; higher = more fragmented terrain.",
      "label": "噪声缩放",
      "mode": "parameter"
    },
    {
      "name": "warpStrength",
      "type": "number",
      "defaultValue": 1.2,
      "description": "Domain warp strength: 0=round peaks, 1.2=organic flow like topographic maps, 2+=extreme distortion.",
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
    }
  ],
  "outputs": [
    {
      "name": "contourLayers",
      "type": "array",
      "description": "Grid list of length contourLevels; each grid covers one elevation band with all cells filled (value = band index), no empty areas.",
      "label": "等高线列表"
    },
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Continuous 0-100 height field for downstream biome classification or terrain rendering.",
      "label": "高度场"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for each contour layer, aligned with contourLayers indices.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
