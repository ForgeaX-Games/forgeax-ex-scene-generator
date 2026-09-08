// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "coastalLink",
  "contractVersion": "1.0.0",
  "opId": "coastal_link",
  "description": "Thins the coastal road to a 1px centerline, orders each component into a continuous polyline, lays long scenic strips along the whole coast (duty-cycle controlled, kept regardless of main-road distance), then grows spaced inland ramps to connect strips into the main road. Accepts coastal road of any width.",
  "inputs": [
    {
      "name": "coastalRoadGrid",
      "type": "grid",
      "description": "coastal_roads 的 roadGrid 输出，任意宽度均可（内部会细化成 1px 再处理）。",
      "label": "沿海道路网格"
    },
    {
      "name": "mainRoadGrid",
      "type": "grid",
      "description": "长条沿途会生长匝道接入此主路。",
      "label": "主路网格"
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
      "name": "keepRatio",
      "type": "number",
      "defaultValue": 0.7,
      "description": "海岸被铺成观光路的占空比；1=连续完整环线，0.7=70% 有路、30% 留缝形成长条。",
      "label": "占空比",
      "mode": "parameter"
    },
    {
      "name": "segLen",
      "type": "number",
      "defaultValue": 120,
      "description": "每条沿海长条的近似弧长（像素）；越大越接近连续长条观光线。",
      "label": "长条段长",
      "mode": "parameter"
    },
    {
      "name": "connectDist",
      "type": "number",
      "defaultValue": 70,
      "description": "长条沿途采样点到主路的最大接入距离；超出则不生长匝道（长条仍保留）。0=不接主路。",
      "label": "匝道接入距离",
      "mode": "parameter"
    },
    {
      "name": "connectSpacing",
      "type": "number",
      "defaultValue": 90,
      "description": "沿长条每隔多少像素尝试生长一条接入主路的匝道。",
      "label": "匝道间距",
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
      "label": "沿海接驳路"
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
