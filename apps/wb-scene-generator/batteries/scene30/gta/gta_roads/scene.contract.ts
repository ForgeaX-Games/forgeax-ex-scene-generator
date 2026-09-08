// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaRoads",
  "contractVersion": "1.0.0",
  "opId": "gta_roads",
  "description": "Generates a GTA-style urban road network from country/land shapes: coastal inset buildable zones, ring roads, arterials, and district street grids.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "countryGrid",
      "type": "grid",
      "label": "国家网格"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "description": "可选。接入后道路会少穿越高地。",
      "label": "高度图"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260601,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "districtCount",
      "type": "number",
      "defaultValue": 12,
      "label": "街区片区数",
      "mode": "parameter"
    },
    {
      "name": "localSpacing",
      "type": "number",
      "defaultValue": 34,
      "label": "街区道路间距",
      "mode": "parameter"
    },
    {
      "name": "districtRadius",
      "type": "number",
      "defaultValue": 95,
      "label": "片区半径",
      "mode": "parameter"
    },
    {
      "name": "coastInset",
      "type": "number",
      "defaultValue": 10,
      "label": "海岸内缩",
      "mode": "parameter"
    },
    {
      "name": "arterialWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "主路宽度",
      "mode": "parameter"
    },
    {
      "name": "streetWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "街道宽度",
      "mode": "parameter"
    },
    {
      "name": "largestCountryOnly",
      "type": "boolean",
      "defaultValue": false,
      "label": "仅最大国家",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "GTA 路网"
    },
    {
      "name": "roadCenters",
      "type": "array",
      "label": "片区中心"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "GTA 路网"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
