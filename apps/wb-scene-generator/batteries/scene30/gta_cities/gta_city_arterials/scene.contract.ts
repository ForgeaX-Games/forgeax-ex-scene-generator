// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaCityArterials",
  "contractVersion": "1.0.0",
  "opId": "gta_city_arterials",
  "description": "Generates ring roads, radial roads, and cross-district arterials for a GTA-style city skeleton.",
  "inputs": [
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
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260612,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 2,
      "label": "主路宽度",
      "mode": "parameter"
    },
    {
      "name": "ringCount",
      "type": "number",
      "defaultValue": 2,
      "label": "环路数量",
      "mode": "parameter"
    },
    {
      "name": "radialCount",
      "type": "number",
      "defaultValue": 7,
      "label": "放射路数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "arterialGrid",
      "type": "grid",
      "label": "主干路"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "道路网格"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "主路预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
