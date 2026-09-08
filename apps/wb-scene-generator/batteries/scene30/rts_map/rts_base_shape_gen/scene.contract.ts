// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rtsBaseShapeGen",
  "contractVersion": "6.0.0",
  "opId": "rts_base_shape_gen",
  "description": "Multi-sub-seed competitive growth: each region uses subSeeds sub-seeds that merge into one organic multi-lobed blob; different regions repel each other via gapWidth gap. 3 regions placed in L-shaped edge segments (corner, top, left); after quad-symmetry each corner's blobs hug the map border.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input mask grid; non-zero cells define the growable region. Blobs are confined to mask area.",
      "label": "输入网格"
    },
    {
      "name": "numSeeds",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of independent organic blob regions. SC2 corners typically have 3.",
      "label": "区域数",
      "mode": "parameter"
    },
    {
      "name": "subSeeds",
      "type": "number",
      "defaultValue": 4,
      "description": "Sub-seeds per region for multi-lobe organic shape. More = more lobes. Recommended 3-6.",
      "label": "每区域子种子数",
      "mode": "parameter"
    },
    {
      "name": "maxRadius",
      "type": "number",
      "defaultValue": 16,
      "description": "Max expansion radius per sub-seed in cells. Recommended 12-22.",
      "label": "最大膨胀半径",
      "mode": "parameter"
    },
    {
      "name": "radiusVariance",
      "type": "number",
      "defaultValue": 0.25,
      "description": "Variance ratio for per-seed radius. Default 0.25.",
      "label": "半径差异",
      "mode": "parameter"
    },
    {
      "name": "gapWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Min gap between different regions. Recommended 2-5, default 3.",
      "label": "斥力间隙宽度",
      "mode": "parameter"
    },
    {
      "name": "growProb",
      "type": "number",
      "defaultValue": 0.88,
      "description": "Base growth probability per step. Default 0.88.",
      "label": "生长概率",
      "mode": "parameter"
    },
    {
      "name": "noiseAmp",
      "type": "number",
      "defaultValue": 0.12,
      "description": "Noise modulation for organic edges. Default 0.12.",
      "label": "噪声强度",
      "mode": "parameter"
    },
    {
      "name": "subSpacing",
      "type": "number",
      "defaultValue": 6,
      "description": "Spacing between sub-seeds within a region. Controls lobe separation. Recommended 4-10, default 6.",
      "label": "子种子间距",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp for unique results.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "baseGrid",
      "type": "grid",
      "description": "Merged platform mask: 1=any platform, 0=empty.",
      "label": "基地形状网格"
    },
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Per-region 1-based ID grid; 0=empty.",
      "label": "区域 ID 网格"
    }
  ],
  "deterministic": true
})
