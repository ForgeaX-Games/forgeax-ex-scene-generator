// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "mstRoadNetwork",
  "contractVersion": "1.0.0",
  "opId": "mst_road_network",
  "description": "Builds a minimum spanning tree (Kruskal or Prim) over a set of points and rasterizes each edge to a grid as a road network. Optionally add extra cycle edges to avoid an overly sparse layout.",
  "inputs": [
    {
      "name": "points",
      "type": "number",
      "defaultValue": [],
      "description": "Node coordinates [[x,y], ...]. At least 2 points required (rank=2; legacy string \"x1,y1; x2,y2\" also accepted).",
      "label": "点列表",
      "mode": "parameter"
    },
    {
      "name": "grid",
      "type": "grid",
      "description": "Optional cost grid, only used when metric=grid_path (Dijkstra inter-point shortest cost).",
      "label": "代价网格"
    },
    {
      "name": "algorithm",
      "type": "string",
      "defaultValue": "kruskal",
      "description": "MST algorithm: kruskal (union-find) or prim (heap).",
      "label": "算法",
      "options": [
        "kruskal",
        "prim"
      ],
      "mode": "parameter"
    },
    {
      "name": "metric",
      "type": "string",
      "defaultValue": "euclidean",
      "description": "Edge metric: euclidean, manhattan, or grid_path (requires grid input).",
      "label": "距离度量",
      "options": [
        "euclidean",
        "manhattan",
        "grid_path"
      ],
      "mode": "parameter"
    },
    {
      "name": "extraEdgeRatio",
      "type": "number",
      "defaultValue": 0,
      "description": "Ratio (0~1) of extra short edges to add on top of the MST. 0=pure MST, 1=full graph (creates loops).",
      "label": "额外边比例",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Width of roadGrid when grid input is absent.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Height of roadGrid when grid input is absent.",
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "diagonal",
      "type": "boolean",
      "defaultValue": true,
      "description": "When metric=grid_path, allow 8-directional Dijkstra.",
      "label": "对角寻路",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "description": "Rasterized road grid (1=road, 0=empty).",
      "label": "路网网格"
    },
    {
      "name": "edges",
      "type": "dict",
      "description": "Array of edges, each {from:[x,y], to:[x,y], cost:number, mst:boolean} (rank=1).",
      "label": "边列表"
    },
    {
      "name": "totalCost",
      "type": "number",
      "description": "Sum of weights of all output edges.",
      "label": "总边权"
    }
  ],
  "deterministic": true
})
