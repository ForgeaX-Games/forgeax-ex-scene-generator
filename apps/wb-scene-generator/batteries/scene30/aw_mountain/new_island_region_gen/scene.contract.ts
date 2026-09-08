// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "newIslandRegionGen",
  "contractVersion": "1.0.0",
  "opId": "new_island_region_gen",
  "description": "Within the input grid (valid placement mask), treat the incoming point list as per-island anchors (one island per point) and grow organic island regions using island_poisson_gen's internal algorithm (sub-seed scatter + competitive BFS growth + small-fragment cleanup + majority-vote smoothing). The only difference from island_poisson_gen is that anchors come from the point list instead of Poisson-disk sampling, so islands appear at the specified positions.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Mask of valid island placement area (non-zero = valid). Grid size determines output size; islands only grow within the mask.",
      "label": "区域网格"
    },
    {
      "name": "points",
      "type": "point2d",
      "access": "list",
      "required": true,
      "description": "List of island center anchors (x→column, y→row); each point yields one island (islandId = index+1). Out-of-bounds points are ignored.",
      "label": "岛屿锚点"
    },
    {
      "name": "islandSizes",
      "type": "number",
      "access": "list",
      "required": false,
      "defaultValue": [
        12
      ],
      "description": "Per-island expansion radius (cells), aligned with points; if shorter than points, the last value is reused. Recommended 6-20. Default [12].",
      "label": "岛屿大小列表",
      "mode": "parameter"
    },
    {
      "name": "radiusVar",
      "type": "number",
      "access": "item",
      "required": false,
      "defaultValue": 0.3,
      "description": "Per-island sub-seed size variance. 0=uniform, 0.8=max variety. Default 0.3.",
      "label": "大小随机差异",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "required": false,
      "defaultValue": 0,
      "description": "Random seed; 0 = random each time. Default 0.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "islandGrid",
      "type": "grid",
      "access": "item",
      "description": "Land binary mask: 1=island/land, 0=water. All islands merged into one mask.",
      "label": "岛屿网格"
    },
    {
      "name": "waterGrid",
      "type": "grid",
      "access": "item",
      "description": "Water binary mask: 1=water, 0=island/land (= 1 - islandGrid).",
      "label": "水面网格"
    },
    {
      "name": "regionGrid",
      "type": "grid",
      "access": "item",
      "description": "Per-island 1-based ID grid (matching point index). 0=water; use to distinguish islands.",
      "label": "岛屿 ID 网格"
    }
  ],
  "deterministic": true
})
