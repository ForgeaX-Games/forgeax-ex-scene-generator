// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaMainroadZones",
  "contractVersion": "1.0.0",
  "opId": "gta_mainroad_zones",
  "description": "Preserves the legacy GTA zone generator as a stable pre-step for the current gta_main_roads workflow.",
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
      "defaultValue": 20260602,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "coastInset",
      "type": "number",
      "defaultValue": 10,
      "label": "海岸退让",
      "mode": "parameter"
    },
    {
      "name": "urbanCoverage",
      "type": "number",
      "defaultValue": 0.72,
      "label": "城区覆盖率",
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
