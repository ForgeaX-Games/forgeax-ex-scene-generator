// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaCityParcels",
  "contractVersion": "1.0.0",
  "opId": "gta_city_parcels",
  "description": "Extracts developable parcels from roads and districts for building footprint placement.",
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
      "name": "minParcelArea",
      "type": "number",
      "defaultValue": 24,
      "label": "最小地块面积",
      "mode": "parameter"
    },
    {
      "name": "roadSetback",
      "type": "number",
      "defaultValue": 1,
      "label": "道路退让",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "parcelGrid",
      "type": "grid",
      "label": "地块网格"
    },
    {
      "name": "developableMask",
      "type": "grid",
      "label": "可开发掩码"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "地块预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
