// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaCityStreets",
  "contractVersion": "1.0.0",
  "opId": "gta_city_streets",
  "description": "Generates local street fabrics per district, with dense CBD streets and sparser industrial/suburban roads.",
  "inputs": [
    {
      "name": "districtGrid",
      "type": "grid",
      "label": "功能片区"
    },
    {
      "name": "arterialGrid",
      "type": "grid",
      "label": "主干路"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "已有道路"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260613,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "baseSpacing",
      "type": "number",
      "defaultValue": 30,
      "label": "基础街距",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 0,
      "label": "街巷宽度",
      "mode": "parameter"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.74,
      "label": "街巷密度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "streetGrid",
      "type": "grid",
      "label": "街巷"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "完整道路"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "道路预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
