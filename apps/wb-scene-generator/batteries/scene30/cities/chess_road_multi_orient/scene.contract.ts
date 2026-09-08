// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "chessRoadMultiOrient",
  "contractVersion": "1.0.0",
  "opId": "chess_road_multi_orient",
  "description": "Divide the mask into Voronoi zones, each with a randomly rotated grid road layout; zone boundaries become main roads, producing a multi-era city planning effect.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Source mask grid; any non-zero cell is treated as a valid road-generation area.",
      "label": "输入网格"
    },
    {
      "name": "mainSpacing",
      "type": "number",
      "defaultValue": 24,
      "description": "Spacing between main road lines in grid cells. Recommended 12–40.",
      "label": "主路间距",
      "mode": "parameter"
    },
    {
      "name": "subSpacing",
      "type": "number",
      "defaultValue": 8,
      "description": "Spacing between sub-road lines in grid cells. Recommended 4–16, must be less than mainSpacing.",
      "label": "辅路间距",
      "mode": "parameter"
    },
    {
      "name": "mainRoadWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Main road thickness in grid cells. Recommended 1–4.",
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
      "name": "zoneCount",
      "type": "number",
      "defaultValue": 4,
      "description": "Number of Voronoi zones. Recommended 2–8.",
      "label": "子区数量",
      "mode": "parameter"
    },
    {
      "name": "minParcelSize",
      "type": "number",
      "defaultValue": 16,
      "description": "Minimum parcel cell count; parcels smaller than this are removed and filled as sub-road. 0 = no filtering.",
      "label": "最小地块面积",
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
