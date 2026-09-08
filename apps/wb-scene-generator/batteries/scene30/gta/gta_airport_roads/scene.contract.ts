// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaAirportRoads",
  "contractVersion": "1.0.0",
  "opId": "gta_airport_roads",
  "description": "Generates a standalone runway, taxi/service roads, and an entrance road that connects the airport to the existing city road grid.",
  "inputs": [
    {
      "name": "airportMask",
      "type": "grid",
      "label": "机场掩码"
    },
    {
      "name": "airportSite",
      "type": "object",
      "label": "机场站点参数"
    },
    {
      "name": "cityRoadGrid",
      "type": "grid",
      "label": "城市道路网格"
    },
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
      "name": "runwayWidth",
      "type": "number",
      "defaultValue": 10,
      "label": "跑道宽度",
      "mode": "parameter"
    },
    {
      "name": "taxiwayWidth",
      "type": "number",
      "defaultValue": 4,
      "label": "滑行道宽度",
      "mode": "parameter"
    },
    {
      "name": "entranceWidth",
      "type": "number",
      "defaultValue": 2,
      "label": "入口道路宽度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "城市+机场道路"
    },
    {
      "name": "runwayGrid",
      "type": "grid",
      "label": "机场跑道"
    },
    {
      "name": "entranceRoadGrid",
      "type": "grid",
      "label": "机场入口道路"
    },
    {
      "name": "serviceRoadGrid",
      "type": "grid",
      "label": "机场服务道路"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "机场道路预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
