// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaLocalRoads",
  "contractVersion": "1.0.0",
  "opId": "gta_local_roads",
  "description": "Adds short local streets inside residential/commercial districts to create building parcels without overwhelming arterials.",
  "inputs": [
    {
      "name": "zoneGrid",
      "type": "grid",
      "label": "功能区网格"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "主路+辅路"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "label": "高度图"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260605,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "spacing",
      "type": "number",
      "defaultValue": 28,
      "label": "小路间距",
      "mode": "parameter"
    },
    {
      "name": "coverage",
      "type": "number",
      "defaultValue": 0.52,
      "label": "补路覆盖",
      "mode": "parameter"
    },
    {
      "name": "connectRadius",
      "type": "number",
      "defaultValue": 120,
      "label": "连通桥接半径",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "完整道路"
    },
    {
      "name": "localRoadGrid",
      "type": "grid",
      "label": "小路网格"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "完整道路预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
