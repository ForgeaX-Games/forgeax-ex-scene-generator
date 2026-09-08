// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cityGrid",
  "contractVersion": "2.0.0",
  "opId": "city_grid",
  "description": "Uses BSP to generate hierarchical street grids inside urban zones: combined main+auxiliary roads define super-blocks, recursive bisection creates varied block sizes with dense CBD and sparse curved suburbs, per-super-block rotation, and automatic extension to connect into existing road networks.",
  "inputs": [
    {
      "name": "zoneGrid",
      "type": "grid",
      "description": "gta_zones 的 zoneGrid（决定城区位置与密度）。",
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
      "description": "用于定义超级街区边界和对齐格网方向。",
      "label": "主路网格"
    },
    {
      "name": "existingRoadGrid",
      "type": "grid",
      "description": "coastal_link / road_trim 等已有辅路，与主路一起定义超级街区边界并用于连通性检测。",
      "label": "已有辅路网格"
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
      "description": "BSP 最小街区的基础尺寸(像素)。CBD 约 0.7x，住宅 1.2x，工业 2.5x，郊区 4.0x。",
      "label": "基础街区尺寸",
      "mode": "parameter"
    },
    {
      "name": "coastInset",
      "type": "number",
      "defaultValue": 6,
      "description": "格网距海岸保留的退让带，避免街道戳到水边。",
      "label": "海岸退让",
      "mode": "parameter"
    },
    {
      "name": "dirRadius",
      "type": "number",
      "defaultValue": 60,
      "description": "在此半径内取最近路网方向用于对齐 BSP 朝向。",
      "label": "方向取样半径",
      "mode": "parameter"
    },
    {
      "name": "minRegionArea",
      "type": "number",
      "defaultValue": 200,
      "description": "小于此面积的超级街区不做 BSP 细分。",
      "label": "最小成格区域",
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
      "label": "BSP街道路网"
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
