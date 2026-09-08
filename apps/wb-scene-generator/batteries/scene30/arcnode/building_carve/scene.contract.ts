// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingCarve",
  "contractVersion": "1.0.0",
  "opId": "building_carve",
  "description": "Applies two-layer segmented setback on the bounding box of non-zero input cells, then scales the result up from its center so the final shape's bounding box matches the original.",
  "inputs": [
    {
      "name": "gridList",
      "type": "array",
      "description": "List of source grids; the bounding box of non-zero pixels in each grid is used as the building rectangle.",
      "label": "输入网格列表"
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
      "description": "List of grids corresponding to input; building area=1, elsewhere=0; the bounding box matches the input exactly.",
      "label": "建筑占地列表"
    }
  ],
  "deterministic": true
})
