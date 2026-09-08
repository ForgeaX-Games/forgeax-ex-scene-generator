// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "roadTrim",
  "contractVersion": "1.0.0",
  "opId": "road_trim",
  "description": "CAD-style trim: thin the input road to 1px, cut it by the cutter (main road), then prune dead-end spurs that poke the coast / fall outside city zones / dangle internally, keeping only main-anchored branches that further subdivide blocks plus a few small roads. Input road may be any width (auto-thinned).",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "如 connected_roads 的 roadGrid，任意宽度（内部自动细化成 1px）。",
      "label": "待裁剪路网"
    },
    {
      "name": "cutterGrid",
      "type": "grid",
      "description": "如 main_roads 的 roadGrid，用于切开并作为修剪/保留锚点。",
      "label": "切割网格"
    },
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "zoneGrid",
      "type": "grid",
      "description": "可选；提供后可只保留城区道路并删掉落在非城区的出头。",
      "label": "功能区网格"
    },
    {
      "name": "cityOnly",
      "type": "boolean",
      "defaultValue": false,
      "description": "开启后只保留落在城区(商业/住宅/工业/郊区)的道路，避免穿越公园/绿化。",
      "label": "仅城区保留",
      "mode": "parameter"
    },
    {
      "name": "cutWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "切割网对道路的额外切割宽度，0 表示仅移除重叠像素。锚点带宽随之 +1。",
      "label": "切割宽度",
      "mode": "parameter"
    },
    {
      "name": "coastBand",
      "type": "number",
      "defaultValue": 14,
      "description": "末梢落在距陆地/海岸边缘此像素内的死胡同出头将被整条剪掉（即便它另一端连主路）。越大越能过滤直戳海岸的支线。",
      "label": "海岸修剪带",
      "mode": "parameter"
    },
    {
      "name": "minBranchLen",
      "type": "number",
      "defaultValue": 14,
      "description": "短于此长度且远端只连到交叉点（非主路）的内部悬挂分支视为多余小路剔除。",
      "label": "最短内部分支",
      "mode": "parameter"
    },
    {
      "name": "passes",
      "type": "number",
      "defaultValue": 6,
      "label": "修剪轮数",
      "mode": "parameter"
    },
    {
      "name": "minIslandArea",
      "type": "number",
      "defaultValue": 1200,
      "label": "最小成路岛屿面积",
      "mode": "parameter"
    },
    {
      "name": "minKeep",
      "type": "number",
      "defaultValue": 12,
      "description": "短于此像素数、或完全不贴近主路的连通块被清除（消除点状碎块）。",
      "label": "最小连通块",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "输出宽度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "裁剪后路网"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
