// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "terrainNoiseGen",
  "contractVersion": "1.0.0",
  "opId": "terrain_noise_gen",
  "description": "Generates a terrain grid using fractional Brownian motion (FBM) noise, thresholded into water, sand, and grass zones.",
  "inputs": [
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "description": "Map width in grid columns; required, no output if not connected.",
      "label": "地图宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "description": "Map height in grid rows; required, no output if not connected.",
      "label": "地图高度",
      "mode": "parameter"
    },
    {
      "name": "scale",
      "type": "number",
      "defaultValue": 0.05,
      "description": "Noise frequency scale; smaller = broader terrain, larger = more fragmented.",
      "label": "噪声频率",
      "mode": "parameter"
    },
    {
      "name": "waterThresh",
      "type": "number",
      "defaultValue": 0.35,
      "description": "Noise values below this threshold become water (1). Range 0–1.",
      "label": "水系阈值",
      "mode": "parameter"
    },
    {
      "name": "sandThresh",
      "type": "number",
      "defaultValue": 0.45,
      "description": "Noise values between waterThresh and this become sand (2). Range 0–1.",
      "label": "沙滩阈值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "2D terrain grid: 1=water, 2=sand, 3=grass.",
      "label": "地形网格"
    }
  ],
  "deterministic": true
})
