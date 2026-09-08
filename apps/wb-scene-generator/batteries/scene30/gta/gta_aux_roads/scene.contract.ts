// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaAuxRoads",
  "contractVersion": "3.0.0",
  "opId": "gta_aux_roads",
  "description": "Builds auxiliary roads from main roads, connected roads, coastal roads and zones: connected roads cut by main roads form the block network, selected coastal roads link into main roads, plus a checkerboard street grid inside urban zones.",
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
      "name": "mainRoadGrid",
      "type": "grid",
      "label": "主路网格"
    },
    {
      "name": "connectedRoadGrid",
      "type": "grid",
      "description": "connected_roads 的 roadGrid 输出。",
      "label": "连接道路网格"
    },
    {
      "name": "coastalRoadGrid",
      "type": "grid",
      "description": "coastal_roads 的 roadGrid 输出（可选）。",
      "label": "沿海道路网格"
    },
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260604,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "gridSpacing",
      "type": "number",
      "defaultValue": 20,
      "description": "城区内 BSP 最小街区基础尺寸（像素），按功能区缩放：CBD 0.7x, 住宅 1.2x, 工业 2.5x, 郊区 4.0x。",
      "label": "BSP街区尺寸",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "辅路宽度",
      "mode": "parameter"
    },
    {
      "name": "coastalKeepRatio",
      "type": "number",
      "defaultValue": 0.4,
      "description": "随机保留并接入主路的沿海道路段比例。",
      "label": "沿海保留比例",
      "mode": "parameter"
    },
    {
      "name": "coastalSegLen",
      "type": "number",
      "defaultValue": 36,
      "description": "沿海道路切段的近似弧长，段间留间隙形成分散的观光路。",
      "label": "沿海段长",
      "mode": "parameter"
    },
    {
      "name": "coastalConnectDist",
      "type": "number",
      "defaultValue": 80,
      "description": "沿海道路段端头到主路的最大接入距离；超出则不选取。",
      "label": "沿海接入距离",
      "mode": "parameter"
    },
    {
      "name": "minIslandArea",
      "type": "number",
      "defaultValue": 1200,
      "description": "面积小于此值的小岛不生成任何辅路。",
      "label": "最小成路岛屿面积",
      "mode": "parameter"
    },
    {
      "name": "cutWidth",
      "type": "number",
      "defaultValue": 0,
      "description": "主路对辅路的额外切割宽度，0 表示仅移除主路重叠像素。",
      "label": "主路切割宽度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "主路+辅路"
    },
    {
      "name": "auxRoadGrid",
      "type": "grid",
      "label": "辅路网格"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "辅路预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
