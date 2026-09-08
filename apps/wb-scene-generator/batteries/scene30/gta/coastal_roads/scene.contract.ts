// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "coastalRoads",
  "contractVersion": "1.0.0",
  "opId": "coastal_roads",
  "description": "Insets the land mask by coastDist pixels via BFS distance transform, extracts the iso-distance contour as a coastal road, applies noise perturbation, smooths it, then randomly splits it into segments.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "coastDist",
      "type": "number",
      "defaultValue": 5,
      "description": "道路距海岸边缘的像素距离。",
      "label": "距海岸距离(px)",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "道路宽度(px)",
      "mode": "parameter"
    },
    {
      "name": "perturbAmp",
      "type": "number",
      "defaultValue": 6,
      "description": "噪声对道路位置的最大偏移量，值越大海岸线越弯曲自然。",
      "label": "扰动幅度(px)",
      "mode": "parameter"
    },
    {
      "name": "smoothIter",
      "type": "number",
      "defaultValue": 0,
      "label": "平滑次数",
      "mode": "parameter"
    },
    {
      "name": "segCount",
      "type": "number",
      "defaultValue": 1,
      "description": "将道路随机切分为约 N 段；1 表示连续不断。",
      "label": "分段数",
      "mode": "parameter"
    },
    {
      "name": "segLength",
      "type": "number",
      "defaultValue": 1,
      "description": "每段道路存在的比例（1.0=完全连续，0.7=70% 有路、30% 空缺）。",
      "label": "段长比例",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "道路掩码"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
