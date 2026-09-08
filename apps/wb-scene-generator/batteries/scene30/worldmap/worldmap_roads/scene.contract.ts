// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapRoads",
  "contractVersion": "1.0.0",
  "opId": "worldmap_roads",
  "description": "Generates natural curved inter-city roads, with land segments as roads and sea crossings as a separate tunnel layer.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "cityPoints",
      "type": "array",
      "label": "城市点位"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "label": "高度图"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260533,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 0,
      "label": "主路宽度",
      "mode": "parameter"
    },
    {
      "name": "maxOcean",
      "type": "number",
      "defaultValue": 0.45,
      "label": "额外边最大穿海比例",
      "mode": "parameter"
    },
    {
      "name": "extraEdges",
      "type": "number",
      "defaultValue": 5,
      "label": "额外近邻边",
      "mode": "parameter"
    },
    {
      "name": "localStreetSize",
      "type": "number",
      "defaultValue": 0,
      "label": "城市道路尺寸",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "陆地道路网格"
    },
    {
      "name": "tunnelGrid",
      "type": "grid",
      "label": "海底隧道网格"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "道路+隧道预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
