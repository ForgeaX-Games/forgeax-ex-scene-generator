// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "fermatSpiralSampling",
  "contractVersion": "1.0.0",
  "opId": "fermat_spiral_sampling",
  "description": "Fermat spiral sampling based on the golden angle, generating uniform, cluster-free point distributions within a circular area, with optional jitter.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Width (columns) of the output grid.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Height (rows) of the output grid.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "numPoints",
      "type": "number",
      "defaultValue": 200,
      "description": "Number of sample points to generate.",
      "label": "采样点数",
      "mode": "parameter"
    },
    {
      "name": "jitter",
      "type": "number",
      "defaultValue": 0,
      "description": "Random jitter amount in pixels; 0=perfect spiral, higher values add randomness (0~10).",
      "label": "抖动量",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed for jitter; 0 uses default seed (ignored when jitter=0).",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid; sample point cells = 1, all others = 0.",
      "label": "采样网格"
    },
    {
      "name": "points",
      "type": "number",
      "description": "Array of sample point coordinates [[x, y], ...]; x=column, y=row (rank=2: N points × [x,y]).",
      "label": "坐标列表"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Actual number of sample points within grid bounds.",
      "label": "实际点数"
    }
  ],
  "deterministic": true
})
