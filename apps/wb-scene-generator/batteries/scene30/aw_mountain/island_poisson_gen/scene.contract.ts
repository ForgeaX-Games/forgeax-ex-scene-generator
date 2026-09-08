// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandPoissonGen",
  "contractVersion": "2.0.0",
  "opId": "island_poisson_gen",
  "description": "Input a grid as the valid area, place island anchors via Poisson disk sampling, then grow organic-shaped islands with competitive BFS expansion.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Mask of valid island placement area (non-zero = valid). Grid size determines output size; if not connected, full map is used.",
      "label": "区域网格"
    },
    {
      "name": "numIslands",
      "type": "number",
      "defaultValue": 8,
      "description": "Max number of islands. Actual count limited by map area and island size. Default 8.",
      "label": "岛屿数量",
      "mode": "parameter"
    },
    {
      "name": "islandSize",
      "type": "number",
      "defaultValue": 12,
      "description": "Island expansion radius in cells. Recommended 6-20. Default 12.",
      "label": "岛屿大小",
      "mode": "parameter"
    },
    {
      "name": "radiusVar",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Island size variance. 0=uniform, 0.8=max variety. Default 0.3.",
      "label": "大小随机差异",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
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
      "description": "Land binary mask: 1=island/land, 0=water.",
      "label": "岛屿网格"
    },
    {
      "name": "waterGrid",
      "type": "grid",
      "description": "Water binary mask: 1=water, 0=island/land.",
      "label": "水面网格"
    },
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Per-island 1-based ID grid. 0=water.",
      "label": "岛屿 ID 网格"
    }
  ],
  "deterministic": true
})
