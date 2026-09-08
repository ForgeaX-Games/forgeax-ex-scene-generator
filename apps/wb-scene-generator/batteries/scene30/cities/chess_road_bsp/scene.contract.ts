// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "chessRoadBsp",
  "contractVersion": "1.0.0",
  "opId": "chess_road_bsp",
  "description": "Generate a chess-town grid road layout using two-level BSP across all non-zero cells of the input grid. Outputs separate grids for main roads, sub-roads, and individually numbered parcels.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Source mask grid; any non-zero cell is treated as a valid road-generation area.",
      "label": "输入网格"
    },
    {
      "name": "mainRoadWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Main road thickness in grid cells. Recommended 2–4.",
      "label": "主路宽度",
      "mode": "parameter"
    },
    {
      "name": "subRoadWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Sub-road thickness in grid cells. Recommended 1–2.",
      "label": "辅路宽度",
      "mode": "parameter"
    },
    {
      "name": "mainBlockMinSize",
      "type": "number",
      "defaultValue": 20,
      "description": "Minimum dimension of a super-block after main-road BSP splits. Controls main road density.",
      "label": "主块最小尺寸",
      "mode": "parameter"
    },
    {
      "name": "parcelMinSize",
      "type": "number",
      "defaultValue": 8,
      "description": "Minimum dimension of a parcel after sub-road BSP splits. Controls parcel size.",
      "label": "地块最小尺寸",
      "mode": "parameter"
    },
    {
      "name": "splitRatio",
      "type": "number",
      "defaultValue": 0.4,
      "description": "Minimum fraction each side takes after a split (0–0.5). Higher = more uniform splits. Recommended 0.35–0.45.",
      "label": "分割比例下限",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp for a different result each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "mainRoad",
      "type": "grid",
      "description": "Main road mask grid: main road cells = 1, others = 0.",
      "label": "主路"
    },
    {
      "name": "subRoad",
      "type": "grid",
      "description": "Sub-road mask grid: sub-road cells = 1, others = 0.",
      "label": "辅路"
    },
    {
      "name": "parcels",
      "type": "grid",
      "description": "Multi-value parcel grid: each parcel has a unique integer ID (1, 2, 3…); non-parcel cells = 0.",
      "label": "地块"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Parcel name list: [{id, name}] entries for every parcel that contains at least one cell.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
