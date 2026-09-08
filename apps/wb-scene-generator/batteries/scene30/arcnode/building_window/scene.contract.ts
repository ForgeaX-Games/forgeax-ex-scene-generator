// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingWindow",
  "contractVersion": "1.0.0",
  "opId": "building_window",
  "description": "Punches window openings of specified count and width into a wall grid; openings are only placed on wall segments that have open space on both sides.",
  "inputs": [
    {
      "name": "gridList",
      "type": "array",
      "description": "List of wall mask grids; non-zero values in each grid are treated as wall cells.",
      "label": "墙体网格列表"
    },
    {
      "name": "windowCount",
      "type": "number",
      "defaultValue": 7,
      "description": "Total number of window openings to place.",
      "label": "开窗数量",
      "mode": "parameter"
    },
    {
      "name": "windowWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Width of each window opening in cells along the wall direction; minimum is 1.",
      "label": "窗宽（格）",
      "mode": "parameter"
    },
    {
      "name": "randomEnable",
      "type": "bool",
      "defaultValue": true,
      "description": "true = randomly select window positions; false = evenly distribute windows along wall.",
      "label": "随机开启"
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
      "description": "List of grids corresponding to input; window opening cells=0, all others retain original values.",
      "label": "开窗后网格列表"
    },
    {
      "name": "windowGridList",
      "type": "array",
      "description": "List of grids corresponding to input; window opening cells=1, all other cells=0.",
      "label": "窗列表"
    }
  ],
  "deterministic": true
})
