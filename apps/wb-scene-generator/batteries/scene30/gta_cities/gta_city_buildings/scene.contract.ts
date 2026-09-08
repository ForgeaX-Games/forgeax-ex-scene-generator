// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaCityBuildings",
  "contractVersion": "1.0.0",
  "opId": "gta_city_buildings",
  "description": "Places rectangular building footprints inside parcels: dense CBD, medium residential, large industrial boxes, and sparse suburbs.",
  "inputs": [
    {
      "name": "districtGrid",
      "type": "grid",
      "label": "功能片区"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "完整道路"
    },
    {
      "name": "parcelGrid",
      "type": "grid",
      "label": "地块网格"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260615,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.68,
      "label": "建筑密度",
      "mode": "parameter"
    },
    {
      "name": "minRoadDist",
      "type": "number",
      "defaultValue": 2,
      "label": "最小临路距离",
      "mode": "parameter"
    },
    {
      "name": "maxRoadDist",
      "type": "number",
      "defaultValue": 18,
      "label": "最大临路距离",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "buildingGrid",
      "type": "grid",
      "label": "建筑网格"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "建筑预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
