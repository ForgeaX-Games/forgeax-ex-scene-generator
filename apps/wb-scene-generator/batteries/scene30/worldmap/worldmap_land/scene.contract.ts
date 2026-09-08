// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapLand",
  "contractVersion": "1.0.0",
  "opId": "worldmap_land",
  "description": "Builds a land mask from a height map and sea level, then smooths coastlines with cellular majority voting.",
  "inputs": [
    {
      "name": "heightMap",
      "type": "grid",
      "label": "高度图"
    },
    {
      "name": "seaLevel",
      "type": "number",
      "defaultValue": 0.48,
      "label": "海平面",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 3,
      "label": "平滑次数",
      "mode": "parameter"
    },
    {
      "name": "birthLimit",
      "type": "number",
      "defaultValue": 5,
      "label": "成陆阈值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "海陆预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
