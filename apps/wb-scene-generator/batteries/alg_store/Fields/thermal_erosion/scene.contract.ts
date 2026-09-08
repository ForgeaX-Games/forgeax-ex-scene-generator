// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "thermalErosion",
  "contractVersion": "1.0.0",
  "opId": "thermal_erosion",
  "description": "Thermal weathering simulation: cells with slope above the talus angle transport material to lower neighbors. After many iterations cliffs collapse into talus piles, producing natural footslopes and scree.",
  "inputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Input continuous heightmap.",
      "label": "高度图"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 50,
      "description": "Whole-grid sweep iterations; more = more thorough collapse.",
      "label": "迭代次数",
      "mode": "parameter"
    },
    {
      "name": "talusAngle",
      "type": "number",
      "defaultValue": 0.05,
      "description": "Neighbor height-difference threshold; only differences above this trigger material transport.",
      "label": "临界坡度",
      "mode": "parameter"
    },
    {
      "name": "transportRate",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Fraction of excess height transported per iteration 0~1.",
      "label": "输送比例",
      "mode": "parameter"
    },
    {
      "name": "diagonal",
      "type": "boolean",
      "defaultValue": true,
      "description": "Whether to include 8-neighborhood transport.",
      "label": "对角邻居",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Heightmap after thermal weathering.",
      "label": "侵蚀后高度图"
    }
  ],
  "deterministic": true
})
