// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaZones",
  "contractVersion": "3.0.0",
  "opId": "gta_zones",
  "description": "Generates GTA-style zoning from gta_heightmap terrain layers (beach/plains/hills/mountain): subdivides plains into CBD, residential, industrial harbor and central parks; turns hills into large greening areas; keeps mountains natural and coast as beach.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "plainsGrid",
      "type": "grid",
      "description": "gta_heightmap 的平原层；城市开发区在此生成。",
      "label": "平原掩码"
    },
    {
      "name": "beachGrid",
      "type": "grid",
      "description": "gta_heightmap 的沙滩层；保留为沙滩区。",
      "label": "沙滩掩码"
    },
    {
      "name": "hillsGrid",
      "type": "grid",
      "description": "gta_heightmap 的丘陵层；转为山地绿化。",
      "label": "丘陵掩码"
    },
    {
      "name": "mountainGrid",
      "type": "grid",
      "description": "gta_heightmap 的山地层；保留为自然山地。",
      "label": "山地掩码"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "description": "用于坡度评分；地形掩码缺失时按阈值回退派生。",
      "label": "高度图（可选）"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260602,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "coastInset",
      "type": "number",
      "defaultValue": 6,
      "description": "商业核心距海岸的最小退让；工业港带紧贴此距离。",
      "label": "海岸退让",
      "mode": "parameter"
    },
    {
      "name": "parkDensity",
      "type": "number",
      "defaultValue": 1,
      "description": "中央公园数量倍率，0 表示不生成公园。",
      "label": "公园密度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "zoneGrid",
      "type": "grid",
      "label": "功能区网格"
    },
    {
      "name": "buildableMask",
      "type": "grid",
      "label": "可建设掩码"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "功能区预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
