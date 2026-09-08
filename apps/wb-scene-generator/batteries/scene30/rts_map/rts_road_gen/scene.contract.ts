// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rtsRoadGen",
  "contractVersion": "4.0.0",
  "opId": "rts_road_gen",
  "description": "Auto-detects regions in baseGrid mask; each region provides a near-center entry point and a centroid. Builds a branching polyline corridor network from center, guaranteeing at least one branch endpoint reaches each region.",
  "inputs": [
    {
      "name": "baseGrid",
      "type": "grid",
      "description": "Map mask containing base platform regions (1=platform, 0=empty). Regions are auto-detected; no separate centroid input needed.",
      "label": "基地掩码网格"
    },
    {
      "name": "maxRegions",
      "type": "number",
      "defaultValue": 8,
      "description": "Maximum number of regions (endpoints) to extract from the mask, taken in descending order of region size. Default 8.",
      "label": "最大区域数（终点数）",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 5,
      "description": "Corridor dilation radius in cells; actual width ~2*roadWidth+1. Default 5.",
      "label": "走廊宽度（半径）",
      "mode": "parameter"
    },
    {
      "name": "centerRadius",
      "type": "number",
      "defaultValue": 8,
      "description": "Radius of the circular center hub area in cells. Default 8.",
      "label": "中心枢纽半径",
      "mode": "parameter"
    },
    {
      "name": "enableBranch",
      "type": "bool",
      "defaultValue": true,
      "description": "false=star (4 direct arms); true=per-arm fork (each arm branches at junctionDist into 2 sub-paths, 8 total). Default true.",
      "label": "启用分叉"
    },
    {
      "name": "waypointsPerLeg",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of waypoints inserted per path segment (0=direct, 1=one bend, 2=two bends). Default 1.",
      "label": "每段拐点数",
      "mode": "parameter"
    },
    {
      "name": "waypointOffset",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Max perpendicular offset of waypoints as fraction of segment length (0=none, 0.5=strong bend). Default 0.3.",
      "label": "拐点偏移幅度",
      "mode": "parameter"
    },
    {
      "name": "junctionDist",
      "type": "number",
      "defaultValue": 0.6,
      "description": "Position of the fork node along the trunk (0=near center, 1=near base). Default 0.6.",
      "label": "分叉节点位置比例",
      "mode": "parameter"
    },
    {
      "name": "diagFirst",
      "type": "bool",
      "defaultValue": true,
      "description": "true=diagonal segment first then straight; false=straight first then diagonal. Affects where the bend occurs in each segment. Default true.",
      "label": "先走斜线"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed for waypoint offsets; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "description": "Merged mask of all corridors and center hub; 1=road/hub, 0=empty.",
      "label": "走廊+中心掩码"
    },
    {
      "name": "centerGrid",
      "type": "grid",
      "description": "Mask of the center hub area only.",
      "label": "中心枢纽掩码"
    }
  ],
  "deterministic": true
})
