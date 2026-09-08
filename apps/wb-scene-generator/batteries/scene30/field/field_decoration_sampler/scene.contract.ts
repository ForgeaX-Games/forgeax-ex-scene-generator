// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "fieldDecorationSampler",
  "contractVersion": "1.0.0",
  "opId": "field_decoration_sampler",
  "description": "Samples decorations onto terrain using Poisson disk sampling for trees and bushes, random scattering for rocks and flowers, outputting a decoration grid (0=empty, 1=tree, 2=bush, 3=rock, 4=flower).",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Smoothed terrain grid: 1=water, 2=sand, 3=grass.",
      "label": "地形网格"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "treeRadius",
      "type": "number",
      "defaultValue": 2.5,
      "description": "Minimum Poisson disk radius for trees (in grid cells); larger = sparser.",
      "label": "树木最小间距",
      "mode": "parameter"
    },
    {
      "name": "bushRadius",
      "type": "number",
      "defaultValue": 1.5,
      "description": "Minimum Poisson disk radius for bushes (in grid cells); larger = sparser.",
      "label": "灌木最小间距",
      "mode": "parameter"
    },
    {
      "name": "rockDensity",
      "type": "number",
      "defaultValue": 0.03,
      "description": "Probability of placing a rock on each grass/sand cell. Range 0–1.",
      "label": "岩石密度",
      "mode": "parameter"
    },
    {
      "name": "flowerDensity",
      "type": "number",
      "defaultValue": 0.05,
      "description": "Probability of placing a flower on each empty grass/sand cell. Range 0–1.",
      "label": "小花密度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "decorationGrid",
      "type": "grid",
      "description": "Decoration grid matching terrain size: 0=empty, 1=tree, 2=bush, 3=rock, 4=flower.",
      "label": "装饰物网格"
    }
  ],
  "deterministic": true
})
