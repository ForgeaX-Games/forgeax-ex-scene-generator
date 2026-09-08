// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaMainRoads",
  "contractVersion": "1.0.0",
  "opId": "gta_main_roads",
  "description": "Generates continuous arterials, ring roads, and short bridges from functional zones as the main GTA road skeleton.",
  "inputs": [
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
      "defaultValue": 20260603,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 3,
      "label": "主路宽度",
      "mode": "parameter"
    },
    {
      "name": "bridgeGap",
      "type": "number",
      "defaultValue": 90,
      "label": "最大桥接间隙",
      "mode": "parameter"
    },
    {
      "name": "minIslandArea",
      "type": "number",
      "defaultValue": 1200,
      "description": "面积小于此值的小岛不接入道路网（最大陆块始终连接，超大岛屿视为大陆）。",
      "label": "最小连路岛屿面积",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "mainRoadGrid",
      "type": "grid",
      "label": "主路网格"
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
