// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "voronoiTerrain",
  "contractVersion": "1.3.0",
  "opId": "voronoi_terrain",
  "description": "Voronoi tessellation grid generator; each region is assigned a unique ID. Supports custom seed points, Lloyd relaxation, smooth blending, and bounded mode.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 50,
      "description": "Output grid width in pixels.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 50,
      "description": "Output grid height in pixels.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "seeds",
      "type": "number",
      "defaultValue": [],
      "description": "Seed point array [[x, y], ...] with x, y as absolute grid coordinates (0~width-1, 0~height-1). Each seed auto-receives a region ID starting from 1. Empty = random generation (rank=2).",
      "label": "种子点列表",
      "mode": "parameter"
    },
    {
      "name": "numSeeds",
      "type": "number",
      "defaultValue": 20,
      "description": "Number of random seed points to generate when seeds list is empty.",
      "label": "随机种子点数",
      "mode": "parameter"
    },
    {
      "name": "relaxIterations",
      "type": "number",
      "defaultValue": 3,
      "description": "Lloyd relaxation iterations for more uniform Voronoi cells. 0 = no relaxation.",
      "label": "Lloyd 松弛次数",
      "mode": "parameter"
    },
    {
      "name": "distanceType",
      "type": "string",
      "defaultValue": "euclidean",
      "description": "Distance metric: euclidean (round cells), manhattan (diamond cells), chebyshev (square cells).",
      "label": "距离度量",
      "options": [
        "euclidean",
        "manhattan",
        "chebyshev"
      ],
      "mode": "parameter"
    },
    {
      "name": "smooth",
      "type": "number",
      "defaultValue": 0,
      "description": "Boundary smoothness. 0 = hard Voronoi edges, >0 = inverse-distance-weighted blending for smooth transitions.",
      "label": "平滑度",
      "mode": "parameter"
    },
    {
      "name": "bounded",
      "type": "boolean",
      "defaultValue": false,
      "description": "Whether to constrain polygon size. When enabled, polygons don't extend to map edges but form finite-sized regions surrounded by background (DST-style ocean-seed boundary).",
      "label": "有界模式",
      "mode": "parameter"
    },
    {
      "name": "boundaryValue",
      "type": "number",
      "defaultValue": 0,
      "description": "Fill value for background regions in bounded mode. Default 0. Use any value different from seed v values for easy distinction.",
      "label": "背景填充值",
      "mode": "parameter"
    },
    {
      "name": "boundaryGap",
      "type": "number",
      "defaultValue": 0.8,
      "description": "Buffer radius around seeds in bounded mode, as a fraction of average nearest-neighbor distance. Larger = bigger polygons, less background.",
      "label": "边界间距",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different results.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output Voronoi region grid; each region has a unique positive integer ID starting from 1. In bounded mode, background regions use boundaryValue.",
      "label": "区域网格"
    }
  ],
  "deterministic": true
})
