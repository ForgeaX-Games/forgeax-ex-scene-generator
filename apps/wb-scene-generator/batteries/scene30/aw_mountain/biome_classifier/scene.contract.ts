// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "biomeClassifier",
  "contractVersion": "2.0.0",
  "opId": "biome_classifier",
  "description": "Classifies each cell into one of 7 terrain types using three input fields and configurable thresholds.",
  "inputs": [
    {
      "name": "field1",
      "type": "grid",
      "description": "Primary driving field (0–1 or 0–100); determines the elevation band of each cell.",
      "label": "主场"
    },
    {
      "name": "field2",
      "type": "grid",
      "description": "Secondary field; reserved for future use, not currently used in classification.",
      "label": "次场（预留）"
    },
    {
      "name": "field3",
      "type": "grid",
      "description": "Vegetation/humidity field; determines forest vs. non-forest within lowland and peak zones.",
      "label": "植被场"
    },
    {
      "name": "thresholds",
      "type": "string",
      "defaultValue": "",
      "description": "Optional JSON string to override default thresholds: { beachMax, lowlandMax, footMax, slopeMax, forestMin }.",
      "label": "分类阈值（JSON）",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Terrain grid where each cell is a biome ID 1–7: 1=forest peak, 2=forest foot, 3=grassland, 4=beach, 5=mountain foot, 6=slope, 7=summit.",
      "label": "地块网格"
    },
    {
      "name": "terrainNameList",
      "type": "array",
      "description": "Name list of terrain types actually present in the grid: [{id, name}], ordered by id ascending.",
      "label": "地形名称清单"
    }
  ],
  "deterministic": true
})
