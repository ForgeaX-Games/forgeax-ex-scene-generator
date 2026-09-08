// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "bspRectGen",
  "contractVersion": "3.1.0",
  "opId": "bsp_rect_gen",
  "description": "Scatter compact BSP rectangles around a center point (specified by 3x3 grid position) within a single grid region. Each parcel gets an increasing id in one multi-value grid.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single source mask grid (number[][]); any non-zero cell is treated as the valid region. Grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "centerPoint",
      "type": "point2d",
      "access": "item",
      "description": "Exact scatter-center point2d (x→column, y→row); when connected it overrides centerPosition (clamped into the region). Falls back to centerPosition when not connected.",
      "label": "中心点"
    },
    {
      "name": "centerPosition",
      "type": "number",
      "access": "item",
      "description": "1-9 maps to 3x3 grid positions (1=top-left...9=bottom-right); used when centerPoint is not connected, random each run when neither is set.",
      "label": "中心点位置",
      "mode": "parameter"
    },
    {
      "name": "targetCount",
      "type": "number",
      "access": "item",
      "defaultValue": 10,
      "description": "Target number of rectangles placed from center outward. Default 10.",
      "label": "目标矩形数",
      "mode": "parameter"
    },
    {
      "name": "minSize",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Minimum side length (both width and height) of each rectangle in grid cells. Default 2.",
      "label": "最小宽高",
      "mode": "parameter"
    },
    {
      "name": "maxSize",
      "type": "number",
      "access": "item",
      "defaultValue": 12,
      "description": "Maximum side length of each rectangle in grid cells. Default 12; 0 = no limit.",
      "label": "最大宽高",
      "mode": "parameter"
    },
    {
      "name": "splitRatio",
      "type": "number",
      "access": "item",
      "defaultValue": 0.35,
      "description": "BSP split position range (0.1–0.49); smaller = more uniform splits. Default 0.35.",
      "label": "分割随机度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp for a different result each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each parcel gets an increasing id, 0 elsewhere; pipe to grid_split_by_value to separate parcels.",
      "label": "地块网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Parcel name list [{id, name:'地块 N', type:'tile'}] aligned with the ids in the grid.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
