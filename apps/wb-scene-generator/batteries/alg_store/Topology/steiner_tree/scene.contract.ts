// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "steinerTree",
  "contractVersion": "1.0.0",
  "opId": "steiner_tree",
  "description": "Approximate Steiner tree using a shortest-path metric closure + MST + path expansion. Produces a shorter network than a plain MST and allows intermediate Steiner points; supports obstacle-aware grids.",
  "inputs": [
    {
      "name": "terminals",
      "type": "number",
      "defaultValue": [],
      "description": "Terminal points to connect [[x,y], ...]. At least 2 required (rank=2; legacy string also accepted).",
      "label": "必经点",
      "mode": "parameter"
    },
    {
      "name": "grid",
      "type": "grid",
      "description": "Optional cost grid (0=wall, >0=cost). When supplied, uses Dijkstra path costs between terminals; otherwise Euclidean.",
      "label": "代价网格"
    },
    {
      "name": "metric",
      "type": "string",
      "defaultValue": "grid",
      "description": "grid = grid Dijkstra (requires grid); euclidean = Euclidean + Bresenham line.",
      "label": "距离度量",
      "options": [
        "grid",
        "euclidean"
      ],
      "mode": "parameter"
    },
    {
      "name": "diagonal",
      "type": "boolean",
      "defaultValue": true,
      "description": "Allow 8-directional Dijkstra in grid mode.",
      "label": "允许对角",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Output width when grid is absent.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Output height when grid is absent.",
      "label": "高度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "treeGrid",
      "type": "grid",
      "description": "Rasterized Steiner tree (0/1).",
      "label": "树网格"
    },
    {
      "name": "edges",
      "type": "dict",
      "description": "MST edges over the metric closure: {from,to,cost} (rank=1).",
      "label": "边列表"
    },
    {
      "name": "steinerPoints",
      "type": "number",
      "description": "Intermediate cells introduced by path expansion (excluding terminals) (rank=2).",
      "label": "Steiner 点"
    },
    {
      "name": "totalLength",
      "type": "number",
      "description": "Total number of 1-pixels in the tree grid (rasterized length).",
      "label": "总长度"
    }
  ],
  "deterministic": true
})
