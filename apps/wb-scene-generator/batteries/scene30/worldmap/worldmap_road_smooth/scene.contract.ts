// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapRoadSmooth",
  "contractVersion": "1.0.0",
  "opId": "worldmap_road_smooth",
  "description": "Smooths worldmap roads and tunnels with gap closing, morphological closing, or continuity repair for more coherent road networks.",
  "inputs": [
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
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "algorithm",
      "type": "string",
      "defaultValue": "continuous",
      "label": "平滑算法",
      "options": [
        "close_gaps",
        "majority",
        "continuous"
      ],
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 1,
      "label": "迭代次数",
      "mode": "parameter"
    },
    {
      "name": "gapRadius",
      "type": "number",
      "defaultValue": 10,
      "label": "断点补全半径",
      "mode": "parameter"
    },
    {
      "name": "strokeRadius",
      "type": "number",
      "defaultValue": 0,
      "label": "道路笔刷半径",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "平滑道路网格"
    },
    {
      "name": "tunnelGrid",
      "type": "grid",
      "label": "平滑隧道网格"
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
