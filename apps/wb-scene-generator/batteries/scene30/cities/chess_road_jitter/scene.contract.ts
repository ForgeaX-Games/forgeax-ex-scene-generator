// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "chessRoadJitter",
  "contractVersion": "1.0.0",
  "opId": "chess_road_jitter",
  "description": "Regular grid road segments are divided into sub-segments with random perpendicular jitter (vertical roads jitter left/right, horizontal roads jitter up/down); intersections stay aligned to preserve connectivity.",
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
      "defaultValue": 30,
      "description": "Spacing between main road lines in grid cells. Recommended 12–40.",
      "label": "主路间距",
      "mode": "parameter"
    },
    {
      "name": "subSpacing",
      "type": "number",
      "defaultValue": 20,
      "description": "Spacing between sub-road lines in grid cells. Recommended 4–30, must be less than mainSpacing.",
      "label": "辅路间距",
      "mode": "parameter"
    },
    {
      "name": "mainRoadWidth",
      "type": "number",
      "defaultValue": 4,
      "description": "Main road thickness in grid cells. Recommended 2–6.",
      "label": "主路宽度",
      "mode": "parameter"
    },
    {
      "name": "subRoadWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Sub-road thickness in grid cells. Recommended 1–3.",
      "label": "辅路宽度",
      "mode": "parameter"
    },
    {
      "name": "jitterAmp",
      "type": "number",
      "defaultValue": 1,
      "description": "Maximum perpendicular displacement of mid-segment waypoints in grid cells. 0 = perfectly regular. Recommended 0–8.",
      "label": "抖动幅度",
      "mode": "parameter"
    },
    {
      "name": "segmentCount",
      "type": "number",
      "defaultValue": 5,
      "description": "Number of sub-segments per road segment between intersections. Higher = denser bends. Recommended 2–8.",
      "label": "每段分节数",
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
