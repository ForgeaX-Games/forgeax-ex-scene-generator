// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandsBiomeAssign",
  "contractVersion": "1.0.0",
  "opId": "islands_biome_assign",
  "description": "Converts height and moisture maps into a raw island biome grid.",
  "inputs": [
    {
      "name": "heightMap",
      "type": "grid",
      "description": "Input floating-point height map in the 0-1 range.",
      "label": "高度图"
    },
    {
      "name": "moistureMap",
      "type": "grid",
      "description": "Input floating-point moisture map in the 0-1 range.",
      "label": "湿度图"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Mapped island terrain grid.",
      "label": "群系网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for the biome grid.",
      "label": "名称清单"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "description": "Pass-through height map for downstream reuse.",
      "label": "透传高度图"
    },
    {
      "name": "moistureMap",
      "type": "grid",
      "description": "Pass-through moisture map for downstream reuse.",
      "label": "透传湿度图"
    }
  ],
  "deterministic": true
})
