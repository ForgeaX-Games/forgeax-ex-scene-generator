// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingInnerDoor",
  "contractVersion": "1.0.0",
  "opId": "building_inner_door",
  "description": "Randomly opens 2–4 cell-wide doorways in interior walls, using a minimum spanning tree to guarantee every room is reachable.",
  "inputs": [
    {
      "name": "gridList",
      "type": "array",
      "description": "List of building outline and interior wall masks; non-zero values in each grid are walls.",
      "label": "建筑墙体列表"
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
      "description": "List of grids corresponding to input; interior walls have 2–4 cell doorways cut through them (set to 0).",
      "label": "开门后墙体列表"
    },
    {
      "name": "doorGridList",
      "type": "array",
      "description": "List of grids corresponding to input; door opening cells=1, all other cells=0.",
      "label": "门列表"
    }
  ],
  "deterministic": true
})
