// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapCountries",
  "contractVersion": "1.0.0",
  "opId": "worldmap_countries",
  "description": "Allocates seeds per land component and grows contiguous countries with terrain-aware costs; borders bend along coasts, highlands, and noise bands while tiny fragments are cleaned up.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "description": "可选。接入后国家边界会更倾向沿高地/地形梯度分布。",
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
      "name": "countryCount",
      "type": "number",
      "defaultValue": 20,
      "label": "国家数量",
      "mode": "parameter"
    },
    {
      "name": "relax",
      "type": "number",
      "defaultValue": 2,
      "label": "边界平滑",
      "mode": "parameter"
    },
    {
      "name": "warp",
      "type": "number",
      "defaultValue": 0.06,
      "label": "边界扰动",
      "mode": "parameter"
    },
    {
      "name": "minPatchArea",
      "type": "number",
      "defaultValue": 48,
      "label": "最小碎片面积",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "countryGrid",
      "type": "grid",
      "label": "国家网格"
    },
    {
      "name": "countryNameList",
      "type": "array",
      "label": "国家名称清单"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "国家网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
