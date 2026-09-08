// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingDoor",
  "contractVersion": "1.0.0",
  "opId": "building_door",
  "description": "Randomly punches door openings of specified count and width into a wall grid; openings are only placed on valid wall segments that connect two open spaces.",
  "inputs": [
    {
      "name": "gridList",
      "type": "array",
      "description": "List of wall mask grids; non-zero values in each grid are treated as wall cells.",
      "label": "墙体网格列表"
    },
    {
      "name": "doorCount",
      "type": "number",
      "defaultValue": 1,
      "description": "Total number of door openings to place.",
      "label": "开门数量",
      "mode": "parameter"
    },
    {
      "name": "doorWidth",
      "type": "number",
      "defaultValue": 2,
      "description": "Width of each door opening in cells along the wall direction; minimum is 1.",
      "label": "门宽（格）",
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
      "description": "List of grids corresponding to input; door opening cells=0, all others retain original values.",
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
