// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "poissonDiskSampling",
  "contractVersion": "1.0.0",
  "opId": "poisson_disk_sampling",
  "description": "Generates uniformly distributed sample points in a given area using Bridson's fast Poisson disk sampling, maintaining a minimum distance between points.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Width (number of columns) of the sampling area.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Height (number of rows) of the sampling area.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "radius",
      "type": "number",
      "defaultValue": 5,
      "description": "Minimum distance between sample points in pixels; larger values produce sparser distributions.",
      "label": "最小距离",
      "mode": "parameter"
    },
    {
      "name": "maxAttempts",
      "type": "number",
      "defaultValue": 30,
      "description": "Maximum attempts to generate a new point around each active point; higher values produce denser, more uniform distributions.",
      "label": "最大尝试次数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different distributions.",
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
      "description": "Total number of sample points generated.",
      "label": "采样点数"
    }
  ],
  "deterministic": true
})
