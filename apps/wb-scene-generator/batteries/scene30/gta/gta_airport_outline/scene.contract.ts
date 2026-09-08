// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaAirportOutline",
  "contractVersion": "1.0.0",
  "opId": "gta_airport_outline",
  "description": "Places a flat elongated airport site near the land/map edge and outputs the airport mask, outline, and site descriptor.",
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
      "defaultValue": 20260607,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "siteLength",
      "type": "number",
      "defaultValue": 168,
      "label": "机场长度",
      "mode": "parameter"
    },
    {
      "name": "siteWidth",
      "type": "number",
      "defaultValue": 70,
      "label": "机场宽度",
      "mode": "parameter"
    },
    {
      "name": "edgeInset",
      "type": "number",
      "defaultValue": 18,
      "label": "边缘退让",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "airportMask",
      "type": "grid",
      "label": "机场掩码"
    },
    {
      "name": "airportOutlineGrid",
      "type": "grid",
      "label": "机场轮廓"
    },
    {
      "name": "airportZoneGrid",
      "type": "grid",
      "label": "机场用地"
    },
    {
      "name": "airportSite",
      "type": "object",
      "label": "机场站点参数"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "机场轮廓预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
