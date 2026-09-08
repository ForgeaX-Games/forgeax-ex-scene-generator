// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "forceDirectedGraph",
  "contractVersion": "1.0.0",
  "opId": "force_directed_graph",
  "description": "DST-style force-directed graph layout using Coulomb repulsion and Hooke attraction. Iteratively simulates node positions and outputs a visualization grid.",
  "inputs": [
    {
      "name": "nodeCount",
      "type": "number",
      "defaultValue": 10,
      "description": "Number of nodes N in the graph (1~500).",
      "label": "节点数量",
      "mode": "parameter"
    },
    {
      "name": "edges",
      "type": "number",
      "description": "Edge list as 2D array e.g. [[0,1],[2,3]], each element is [srcIndex, dstIndex] (0-based) (rank=2: M edges × [src,dst]).",
      "label": "边列表",
      "mode": "parameter"
    },
    {
      "name": "positions",
      "type": "number",
      "description": "Initial node positions [[x,y], ...]; if empty, uses Fermat spiral random initialization (rank=2: N points × [x,y]).",
      "label": "初始坐标",
      "mode": "parameter"
    },
    {
      "name": "gridWidth",
      "type": "number",
      "defaultValue": 50,
      "description": "Output grid width (8~512).",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "gridHeight",
      "type": "number",
      "defaultValue": 50,
      "description": "Output grid height (8~512).",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "repulsion",
      "type": "number",
      "defaultValue": 5000,
      "description": "Coulomb repulsion strength; larger values push nodes further apart.",
      "label": "斥力系数",
      "mode": "parameter"
    },
    {
      "name": "attraction",
      "type": "number",
      "defaultValue": 0.008,
      "description": "Hooke spring attraction strength; larger values pull connected nodes closer.",
      "label": "引力系数",
      "mode": "parameter"
    },
    {
      "name": "damping",
      "type": "number",
      "defaultValue": 0.9,
      "description": "Velocity damping factor (0.01~1); velocity is multiplied by this each iteration.",
      "label": "阻尼系数",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 300,
      "description": "Number of simulation iterations (1~2000); more iterations yield a more stable layout.",
      "label": "迭代次数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different initial layouts.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid where node positions = 1, all others = 0.",
      "label": "可视化网格"
    },
    {
      "name": "nodePositions",
      "type": "number",
      "description": "Final grid coordinates for all nodes as [[x,y], ...] (rank=2: N points × [x,y]).",
      "label": "节点坐标列表"
    }
  ],
  "deterministic": true
})
