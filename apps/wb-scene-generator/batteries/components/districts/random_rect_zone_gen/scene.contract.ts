// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "randomRectZoneGen",
  "contractVersion": "2.0.0",
  "opId": "random_rect_zone_gen",
  "description": "Randomly places non-overlapping axis-aligned rectangles within the target area of a single grid; all rectangles share one multi-value grid, fill values auto-increment from grid max+1.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single 2D grid (number[][]), binary or multi-value. Grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "targetValue",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Rectangles are only placed in cells equal to this value. 0 means any non-zero cell (binary mode); non-zero means exact mask ID matching.",
      "label": "目标区域值",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "defaultValue": 5,
      "description": "Target number of rectangles to place; actual count may be less if space is insufficient.",
      "label": "矩形数量",
      "mode": "parameter"
    },
    {
      "name": "minSize",
      "type": "number",
      "access": "item",
      "defaultValue": 13,
      "description": "Minimum size for both width and height (in cells); width and height are sampled independently within [minSize, maxSize].",
      "label": "最小宽高",
      "mode": "parameter"
    },
    {
      "name": "maxSize",
      "type": "number",
      "access": "item",
      "defaultValue": 19,
      "description": "Maximum size for both width and height (in cells).",
      "label": "最大宽高",
      "mode": "parameter"
    },
    {
      "name": "minDistance",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Minimum gap (in cells) between the nearest edges of any two placed rectangles; 0 allows touching.",
      "label": "最小距离",
      "mode": "parameter"
    },
    {
      "name": "dispersion",
      "type": "number",
      "access": "item",
      "defaultValue": 0.6,
      "description": "0 = random/clustered, 1 = maximally dispersed. Higher values bias new rectangles toward positions far from existing ones; non-overlap rule still applies.",
      "label": "离散程度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp for randomness.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each rectangle gets an increasing id, 0 elsewhere; pipe to grid_split_by_value to separate parcels.",
      "label": "地块网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Parcel name list [{id, name:'地块 N', type:'tile'}] aligned with the ids in the grid.",
      "label": "名称清单"
    },
    {
      "name": "placedCount",
      "type": "number",
      "access": "item",
      "description": "Number of rectangles successfully placed (may be less than count).",
      "label": "实际放置数量"
    }
  ],
  "deterministic": true
})
