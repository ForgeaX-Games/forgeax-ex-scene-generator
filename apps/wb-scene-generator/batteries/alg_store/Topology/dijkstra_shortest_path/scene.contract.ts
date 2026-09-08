// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "dijkstraShortestPath",
  "contractVersion": "1.0.0",
  "opId": "dijkstra_shortest_path",
  "description": "Multi-source / multi-target Dijkstra on a weighted cost grid. Outputs a distance map, a predecessor direction map, and a union path mask for given targets.",
  "inputs": [
    {
      "name": "costGrid",
      "type": "grid",
      "description": "Cost grid. Cells equal to obstacleValue are walls; other cell values are traversal costs (>0). If not provided, all cells default to cost 1.",
      "label": "代价网格"
    },
    {
      "name": "sources",
      "type": "number",
      "defaultValue": [],
      "description": "Source coordinates [[x,y], ...]. Empty = treat every passable cell as a source (rank=2; legacy string also accepted).",
      "label": "起点列表",
      "mode": "parameter"
    },
    {
      "name": "targets",
      "type": "number",
      "defaultValue": [],
      "description": "Target coordinates [[x,y], ...]. Empty = compute distance map only (rank=2; legacy string also accepted).",
      "label": "终点列表",
      "mode": "parameter"
    },
    {
      "name": "diagonal",
      "type": "boolean",
      "defaultValue": false,
      "description": "Allow 8-directional movement (diagonal cost multiplied by √2).",
      "label": "允许对角",
      "mode": "parameter"
    },
    {
      "name": "obstacleValue",
      "type": "number",
      "defaultValue": 0,
      "description": "Cells in costGrid equal to this value are treated as walls.",
      "label": "障碍值",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Output width when costGrid is not provided.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Output height when costGrid is not provided.",
      "label": "高度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "distanceGrid",
      "type": "grid",
      "description": "Shortest cumulative cost from any source; unreachable cells are -1.",
      "label": "距离图"
    },
    {
      "name": "pathGrid",
      "type": "grid",
      "description": "Union of back-traced paths from each target to its closest source. 1=path, 0=empty. All zeros when targets is empty.",
      "label": "路径并集"
    },
    {
      "name": "parentGrid",
      "type": "grid",
      "description": "Per-cell predecessor direction code 1~8 (-1 = source or unreachable).",
      "label": "前驱方向图"
    }
  ],
  "deterministic": true
})
