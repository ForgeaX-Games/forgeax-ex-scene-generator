// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rectPoiPlace",
  "contractVersion": "1.0.0",
  "opId": "rect_poi_place",
  "description": "For each grid in the input list, randomly samples POI points from the edge cells of non-zero regions. Outputs a single point grid with value equal to the max value across all input grids.",
  "inputs": [
    {
      "name": "inputGrids",
      "type": "array",
      "description": "List of input grids; POI points are sampled from the edge cells of non-zero regions in each grid.",
      "label": "网格列表"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of POI points to place per grid layer. Default 3. Capped by available edge cells.",
      "label": "每层点位数量",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current time.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Output grid with all POI points merged; point value = max non-zero value across all input grids, others = 0.",
      "label": "点位网格"
    }
  ],
  "deterministic": true
})
