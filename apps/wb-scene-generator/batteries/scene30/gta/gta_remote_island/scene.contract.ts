// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaRemoteIsland",
  "contractVersion": "1.0.0",
  "opId": "gta_remote_island",
  "description": "Generates a standalone island in open water, with simple internal districts and its own road network.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "现有陆地掩码"
    },
    {
      "name": "avoidMask",
      "type": "grid",
      "label": "避让掩码"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260609,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "radius",
      "type": "number",
      "defaultValue": 58,
      "label": "岛屿半径",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "道路宽度",
      "mode": "parameter"
    },
    {
      "name": "districtCount",
      "type": "number",
      "defaultValue": 5,
      "label": "分区数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "islandGrid",
      "type": "grid",
      "label": "海岛综合网格"
    },
    {
      "name": "islandLandGrid",
      "type": "grid",
      "label": "海岛陆地"
    },
    {
      "name": "islandZoneGrid",
      "type": "grid",
      "label": "海岛分区"
    },
    {
      "name": "islandRoadGrid",
      "type": "grid",
      "label": "海岛道路"
    },
    {
      "name": "islandSite",
      "type": "object",
      "label": "海岛站点参数"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "海岛预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
