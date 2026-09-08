// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaHeightmap",
  "contractVersion": "2.0.0",
  "opId": "gta_heightmap",
  "description": "Generates a GTA-style height field with fBm noise, splits terrain into six binary mask layers (deep sea, shallow sea, beach, plains, hills, mountains), and supports multiple genuinely separate landmasses.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "可选尺寸/掩码网格，非 0 区域生成高度；不接入时使用 width/height。",
      "label": "输入掩码"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 240,
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 140,
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 12345,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "scale",
      "type": "number",
      "defaultValue": 4,
      "label": "特征尺度",
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "defaultValue": 5,
      "label": "倍频数",
      "mode": "parameter"
    },
    {
      "name": "persistence",
      "type": "number",
      "defaultValue": 0.5,
      "label": "持续度",
      "mode": "parameter"
    },
    {
      "name": "falloff",
      "type": "number",
      "defaultValue": 0.55,
      "description": "大陆边缘衰减强度。值越大海岸线越陡峭；值越小边缘越平缓、海岸线更曲折。",
      "label": "海岸锐度",
      "mode": "parameter"
    },
    {
      "name": "landRatio",
      "type": "number",
      "defaultValue": 0.5,
      "description": "陆地占全图面积的比例（近似值）。0.5 ≈ 半个地图为陆地，接近参考世界地图风格。",
      "label": "占地面积率",
      "mode": "parameter"
    },
    {
      "name": "continentCount",
      "type": "number",
      "defaultValue": 1,
      "description": "独立大陆的数量。大于 1 时，各大陆按预设均匀布局分布于地图，之间由深海通道隔开。",
      "label": "大陆数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "heightMap",
      "type": "grid",
      "description": "0~1 浮点高度图，掩码外为 -1。",
      "label": "高度图"
    },
    {
      "name": "deepSeaGrid",
      "type": "grid",
      "description": "深海区域掩码（高度 < 0.28），值为 1。",
      "label": "深海"
    },
    {
      "name": "shallowSeaGrid",
      "type": "grid",
      "description": "浅海区域掩码（0.28 ≤ 高度 < 0.42），值为 1。",
      "label": "浅海"
    },
    {
      "name": "beachGrid",
      "type": "grid",
      "description": "沙滩区域掩码（0.42 ≤ 高度 < 0.47），值为 1。",
      "label": "沙滩"
    },
    {
      "name": "plainsGrid",
      "type": "grid",
      "description": "平原区域掩码（0.47 ≤ 高度 < 0.76），值为 1。",
      "label": "平原"
    },
    {
      "name": "hillsGrid",
      "type": "grid",
      "description": "丘陵区域掩码（0.76 ≤ 高度 < 0.88），值为 1。",
      "label": "丘陵"
    },
    {
      "name": "mountainGrid",
      "type": "grid",
      "description": "山地区域掩码（高度 ≥ 0.88），值为 1。",
      "label": "山地"
    }
  ],
  "deterministic": true
})
