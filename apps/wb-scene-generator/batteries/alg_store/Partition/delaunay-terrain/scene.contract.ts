// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "delaunayTerrain",
  "contractVersion": "1.0.0",
  "opId": "delaunay_terrain",
  "description": "Delaunay triangulation via Bowyer-Watson algorithm. Divides a grid into triangular regions from seed points, each triangle assigned a unique ID.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 128,
      "description": "Output grid width in columns (8~1024).",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 128,
      "description": "Output grid height in rows (8~1024).",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "seeds",
      "type": "number",
      "defaultValue": [],
      "description": "Seed point array [[x, y], ...] with normalized coords in [0,1]. Empty = random (rank=2).",
      "label": "种子点列表",
      "mode": "parameter"
    },
    {
      "name": "numSeeds",
      "type": "number",
      "defaultValue": 20,
      "description": "Number of random seed points when seeds list is empty (3~500).",
      "label": "随机种子点数",
      "mode": "parameter"
    },
    {
      "name": "relaxIterations",
      "type": "number",
      "defaultValue": 0,
      "description": "Lloyd relaxation iterations for more uniform point distribution. 0 = none.",
      "label": "Lloyd 松弛次数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: each triangular region has a unique positive integer ID; areas outside the convex hull are 0.",
      "label": "三角区域网格"
    },
    {
      "name": "triangles",
      "type": "dict",
      "description": "Array of triangle info: [{id, v0:[x,y], v1:[x,y], v2:[x,y]}] (rank=1).",
      "label": "三角形列表"
    },
    {
      "name": "numTriangles",
      "type": "number",
      "description": "Total number of triangles generated.",
      "label": "三角形数量"
    }
  ],
  "deterministic": true
})
