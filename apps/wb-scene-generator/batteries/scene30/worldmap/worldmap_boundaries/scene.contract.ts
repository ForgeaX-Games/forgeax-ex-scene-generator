// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "worldmapBoundaries",
  "contractVersion": "1.0.0",
  "opId": "worldmap_boundaries",
  "description": "Extracts country borders and coastlines from the country grid as an overlay layer.",
  "inputs": [
    {
      "name": "countryGrid",
      "type": "grid",
      "label": "国家网格"
    },
    {
      "name": "includeCoast",
      "type": "bool",
      "defaultValue": true,
      "label": "包含海岸线"
    }
  ],
  "outputs": [
    {
      "name": "boundaryGrid",
      "type": "grid",
      "label": "边界网格"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "边界网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
