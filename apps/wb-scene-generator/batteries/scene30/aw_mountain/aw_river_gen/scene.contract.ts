// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "awRiverGen",
  "contractVersion": "1.0.0",
  "opId": "aw_river_gen",
  "description": "Generates an organic river inside a target biome zone; width adapts automatically to the local terrain width.",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Integer terrain grid from biome_classifier (biome IDs 1–7).",
      "label": "地块网格"
    },
    {
      "name": "targetBiome",
      "type": "number",
      "defaultValue": 3,
      "description": "Biome ID the river will flow through (default 3 = grassland).",
      "label": "目标地块 ID",
      "mode": "parameter"
    },
    {
      "name": "widthScale",
      "type": "number",
      "defaultValue": 0.55,
      "description": "Scale factor mapping distance field value to river width; larger = wider river.",
      "label": "宽度缩放",
      "mode": "parameter"
    },
    {
      "name": "noiseStrength",
      "type": "number",
      "defaultValue": 0.45,
      "description": "Noise perturbation strength for path meandering (0=straight center line, 1=highly winding).",
      "label": "蜿蜒强度",
      "mode": "parameter"
    },
    {
      "name": "smoothSigma",
      "type": "number",
      "defaultValue": 8,
      "description": "Gaussian sigma for width smoothing along path; larger = smoother width transitions.",
      "label": "宽度平滑半径",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of rivers to generate (1–6); each uses a different spatial axis and sub-seed.",
      "label": "河流数量",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "description": "Random seed controlling river start/end points and meandering direction.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "riverMask",
      "type": "grid",
      "description": "Binary grid where river cells are 1 and others are 0; can be overlaid on the terrain grid.",
      "label": "河流掩码"
    }
  ],
  "deterministic": true
})
