// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaCityDistricts",
  "contractVersion": "1.0.0",
  "opId": "gta_city_districts",
  "description": "Generates city-scale GTA districts: CBD, residential fabric, industrial harbor, parks, and suburbs.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "label": "高度图"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260611,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "coastInset",
      "type": "number",
      "defaultValue": 6,
      "label": "海岸退让",
      "mode": "parameter"
    },
    {
      "name": "urbanCoverage",
      "type": "number",
      "defaultValue": 0.78,
      "label": "城区覆盖率",
      "mode": "parameter"
    },
    {
      "name": "centerBias",
      "type": "number",
      "defaultValue": 0.62,
      "label": "中心聚集度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "districtGrid",
      "type": "grid",
      "label": "功能片区"
    },
    {
      "name": "buildableMask",
      "type": "grid",
      "label": "可建设掩码"
    },
    {
      "name": "centerGrid",
      "type": "grid",
      "label": "城市中心点"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "片区预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
