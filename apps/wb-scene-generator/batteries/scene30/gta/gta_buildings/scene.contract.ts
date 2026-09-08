// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaBuildings",
  "contractVersion": "3.0.0",
  "opId": "gta_buildings",
  "description": "Places rotated rectangular and L-shaped buildings in urban zones, oriented along the nearest road. Dense in commercial, medium in residential, large in industrial, sparse in suburbs, rare in parks.",
  "inputs": [
    {
      "name": "zoneGrid",
      "type": "grid",
      "description": "来自 gta_zones（421=商业, 422=住宅, 423=工业, 424=公园, 427=郊区）",
      "label": "功能区网格"
    },
    {
      "name": "mainRoadGrid",
      "type": "grid",
      "description": "来自 gta_main_roads，值 ≥ 300 表示道路",
      "label": "主干路网格"
    },
    {
      "name": "coastalRoadGrid",
      "type": "grid",
      "description": "来自 coastal_link",
      "label": "沿海接驳路"
    },
    {
      "name": "trimRoadGrid",
      "type": "grid",
      "description": "来自 road_trim",
      "label": "裁剪路网"
    },
    {
      "name": "buildableMask",
      "type": "grid",
      "description": "来自 gta_zones 的 buildableMask",
      "label": "可建设掩码"
    },
    {
      "name": "landGrid",
      "type": "grid",
      "description": "来自 gta_land",
      "label": "陆地掩码"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260601,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.7,
      "label": "建筑密度",
      "mode": "parameter"
    },
    {
      "name": "roadSetback",
      "type": "number",
      "defaultValue": 2,
      "label": "退让道路",
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
