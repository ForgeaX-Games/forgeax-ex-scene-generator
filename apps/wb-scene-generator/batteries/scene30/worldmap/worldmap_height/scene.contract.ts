// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapHeight",
  "contractVersion": "1.0.0",
  "opId": "worldmap_height",
  "description": "Generates a fantasy world height field with fBm value noise and radial falloff, plus an early land/ocean preview.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "可选尺寸/掩码网格，非 0 区域生成高度；不接入时使用 width/height。",
      "label": "输入掩码"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 240,
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 140,
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 12345,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "scale",
      "type": "number",
      "defaultValue": 4,
      "label": "特征尺度",
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "defaultValue": 5,
      "label": "倍频数",
      "mode": "parameter"
    },
    {
      "name": "persistence",
      "type": "number",
      "defaultValue": 0.5,
      "label": "持续度",
      "mode": "parameter"
    },
    {
      "name": "falloff",
      "type": "number",
      "defaultValue": 0.5,
      "label": "边缘衰减",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "heightMap",
      "type": "grid",
      "description": "0~1 浮点高度图，掩码外为 -1。",
      "label": "高度图"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "按高度粗分的海洋/海岸/陆地/山地预览。",
      "label": "预览网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
