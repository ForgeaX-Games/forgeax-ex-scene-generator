// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingInnerWall",
  "contractVersion": "2.0.0",
  "opId": "building_inner_wall",
  "description": "Uses BSP (Binary Space Partitioning) to recursively split a building footprint into rooms and draw interior walls of exactly 1-cell width; minimum room size is 2×2.",
  "inputs": [
    {
      "name": "gridList",
      "type": "array",
      "description": "List of building footprint masks; non-zero values in each grid are treated as interior area.",
      "label": "建筑占地列表"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.4,
      "description": "BSP recursion depth control, range 0~1; higher values produce more rooms and denser walls.",
      "label": "分割密度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "List of grids corresponding to input; interior wall pixels=1, elsewhere=0; wall width is always 1 cell.",
      "label": "内墙掩码列表"
    }
  ],
  "deterministic": true
})
