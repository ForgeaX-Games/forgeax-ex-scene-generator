// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandsTerrainRefine",
  "contractVersion": "1.0.0",
  "opId": "islands_terrain_refine",
  "description": "Smooths the raw terrain and adds mud and cliff detail layers.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Base biome terrain grid.",
      "label": "输入地形"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed controlling mud and cliff variation.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "smoothPasses",
      "type": "number",
      "defaultValue": 2,
      "description": "Iteration count for majority-vote smoothing.",
      "label": "平滑次数",
      "mode": "parameter"
    },
    {
      "name": "mudRadius",
      "type": "number",
      "defaultValue": 2,
      "description": "Radius used to search nearby water for mud.",
      "label": "泥地区半径",
      "mode": "parameter"
    },
    {
      "name": "mudChance",
      "type": "number",
      "defaultValue": 0.6,
      "description": "Probability that grass or sand turns into mud.",
      "label": "泥地概率",
      "mode": "parameter"
    },
    {
      "name": "cliffChance",
      "type": "number",
      "defaultValue": 0.65,
      "description": "Probability that mountain cells become cliff.",
      "label": "悬崖转换概率",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Refined terrain with mud and cliff regions.",
      "label": "细化地形"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for the refined terrain.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
