// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRandomRectZoneGen",
  "contractVersion": "1.0.0",
  "opId": "alg_random_rect_zone_gen",
  "description": "Randomly places non-overlapping axis-aligned rectangles within a target region of the input grid. Each rectangle is emitted as a separate 0/1 grid (1 marks the cells covered by that rectangle). When targetValue=0, any non-zero cell is treated as valid (i.e. 1 acts as the region's characteristic function); a non-zero targetValue requires exact mask-ID match.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "required": true,
      "description": "Input 2D grid; rectangles are placed only on valid cells.",
      "label": "输入网格"
    },
    {
      "name": "targetValue",
      "type": "number",
      "defaultValue": 0,
      "description": "Rectangles are placed only on cells equal to this value. 0 treats any non-zero cell as valid (1 as the region's characteristic function, binary mode); a non-zero value requires exact mask-ID match (for irregular / multi-valued regions).",
      "label": "目标区域值",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 5,
      "description": "Target number of rectangles to place; the actual count may be smaller if space is insufficient.",
      "label": "矩形数量",
      "mode": "parameter"
    },
    {
      "name": "minSize",
      "type": "number",
      "defaultValue": 13,
      "description": "Minimum size for both width and height (in cells); width and height are sampled independently within [minSize, maxSize].",
      "label": "最小宽高",
      "mode": "parameter"
    },
    {
      "name": "maxSize",
      "type": "number",
      "defaultValue": 19,
      "description": "Maximum size for both width and height (in cells).",
      "label": "最大宽高",
      "mode": "parameter"
    },
    {
      "name": "minDistance",
      "type": "number",
      "defaultValue": 2,
      "description": "Minimum gap (in cells) between the nearest edges of any two placed rectangles; 0 allows touching.",
      "label": "最小距离",
      "mode": "parameter"
    },
    {
      "name": "dispersion",
      "type": "number",
      "defaultValue": 0.6,
      "description": "0 = random/clustered, 1 = maximally dispersed. Higher values bias new rectangles toward positions far from existing ones; the non-overlap rule always applies.",
      "label": "离散程度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per successfully placed rectangle (1 marks the cells covered by that tile, 0 elsewhere); shape matches the input grid.",
      "label": "地块网格列表"
    },
    {
      "name": "placedCount",
      "type": "number",
      "description": "Number of rectangles successfully placed (may be less than count).",
      "label": "实际放置数量"
    }
  ],
  "deterministic": true
})
