// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapCities",
  "contractVersion": "1.0.0",
  "opId": "worldmap_cities",
  "description": "Places capitals and major cities from country regions, land, and height maps, outputting city points and an overlay grid.",
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
      "label": "高度图"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 12345,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "cityCount",
      "type": "number",
      "defaultValue": 56,
      "label": "城市总数",
      "mode": "parameter"
    },
    {
      "name": "minRegionArea",
      "type": "number",
      "defaultValue": 120,
      "label": "最小可建城区域",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "cityGrid",
      "type": "grid",
      "label": "城市网格"
    },
    {
      "name": "cityPoints",
      "type": "array",
      "label": "城市点位"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "城市网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
