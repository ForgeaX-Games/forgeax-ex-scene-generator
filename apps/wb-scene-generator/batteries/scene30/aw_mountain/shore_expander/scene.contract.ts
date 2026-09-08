// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "shoreExpander",
  "contractVersion": "1.0.0",
  "opId": "shore_expander",
  "description": "Applies BFS expansion on the merged terrain+river grid to generate a shore/beach transition zone around river cells.",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Merged terrain+river grid from grid_max_merge, containing river cells and terrain cells.",
      "label": "地形网格"
    },
    {
      "name": "shoreWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Shore transition width in grid cells; number of BFS expansion layers from river cells.",
      "label": "沙滩宽度",
      "mode": "parameter"
    },
    {
      "name": "riverId",
      "type": "number",
      "defaultValue": 10,
      "description": "Cell value identifying river cells; must match spline_river_mask riverId.",
      "label": "河流格 ID",
      "mode": "parameter"
    },
    {
      "name": "shoreId",
      "type": "number",
      "defaultValue": 2,
      "description": "Cell value to assign to shore cells; should match beach biome ID in biome_classifier (default 2).",
      "label": "沙滩格 ID",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Final terrain grid with shore/beach transition zone added around river cells.",
      "label": "带沙滩地形网格"
    }
  ],
  "deterministic": true
})
