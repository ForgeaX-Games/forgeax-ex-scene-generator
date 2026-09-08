// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapRenderLayers",
  "contractVersion": "1.0.0",
  "opId": "worldmap_render_layers",
  "description": "Combines height, land, borders, cities, roads, airport runways, harbor areas, remote islands, and buildings into renderer-friendly single-value grid layers and a name list.",
  "inputs": [
    {
      "name": "heightMap",
      "type": "grid",
      "label": "高度图"
    },
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "boundaryGrid",
      "type": "grid",
      "label": "边界网格"
    },
    {
      "name": "cityGrid",
      "type": "grid",
      "label": "城市网格"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "道路网格"
    },
    {
      "name": "tunnelGrid",
      "type": "grid",
      "label": "海底隧道网格"
    },
    {
      "name": "harborGrid",
      "type": "grid",
      "label": "码头区域网格"
    },
    {
      "name": "islandGrid",
      "type": "grid",
      "label": "远海海岛网格"
    },
    {
      "name": "buildingGrid",
      "type": "grid",
      "label": "建筑网格"
    },
    {
      "name": "parkGrid",
      "type": "grid",
      "label": "公园绿地网格 (来自 gta_park_overlay)"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "label": "输出网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "输出名称清单"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "合并预览网格"
    }
  ],
  "deterministic": true
})
