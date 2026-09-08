// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tspApproximation",
  "contractVersion": "1.0.0",
  "opId": "tsp_approximation",
  "description": "Approximate Traveling Salesman Problem solver: nearest-neighbor initialization + 2-opt improvement. Outputs visit order, ordered points, and a rasterized path grid (closed loop or open path).",
  "inputs": [
    {
      "name": "points",
      "type": "number",
      "defaultValue": [],
      "description": "Node coordinates [[x,y], ...]. At least 2 points required (rank=2; legacy string also accepted).",
      "label": "点列表",
      "mode": "parameter"
    },
    {
      "name": "closed",
      "type": "boolean",
      "defaultValue": true,
      "description": "true = return to start (loop); false = open path.",
      "label": "闭合回路",
      "mode": "parameter"
    },
    {
      "name": "algorithm",
      "type": "string",
      "defaultValue": "nearest_2opt",
      "description": "nearest_neighbor = pure greedy; nearest_2opt = greedy + 2-opt refinement (recommended).",
      "label": "算法",
      "options": [
        "nearest_neighbor",
        "nearest_2opt"
      ],
      "mode": "parameter"
    },
    {
      "name": "metric",
      "type": "string",
      "defaultValue": "euclidean",
      "description": "Distance metric between points.",
      "label": "距离度量",
      "options": [
        "euclidean",
        "manhattan"
      ],
      "mode": "parameter"
    },
    {
      "name": "maxIterations",
      "type": "number",
      "defaultValue": 1000,
      "description": "Upper bound on 2-opt iterations; the search exits early once reached.",
      "label": "最大迭代",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Width of the pathGrid output.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Height of the pathGrid output.",
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed for nearest_neighbor starting point. 0 uses the current timestamp; non-zero is reproducible.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "order",
      "type": "number",
      "description": "Indices into the input points array in visit order (no closing repeat) (rank=1).",
      "label": "访问顺序"
    },
    {
      "name": "pathPoints",
      "type": "number",
      "description": "Reordered points (closed loops append the start at the end) (rank=2).",
      "label": "顺序点列"
    },
    {
      "name": "pathGrid",
      "type": "grid",
      "description": "Rasterized 0/1 path grid.",
      "label": "路径网格"
    },
    {
      "name": "totalLength",
      "type": "number",
      "description": "Total metric length of the tour (or open path).",
      "label": "总长度"
    }
  ],
  "deterministic": true
})
