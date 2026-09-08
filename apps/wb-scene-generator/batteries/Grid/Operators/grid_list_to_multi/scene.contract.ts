// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridListToMulti",
  "contractVersion": "2.0.0",
  "opId": "grid_list_to_multi",
  "description": "Merges a list of single-value grids into one multi-value grid by layering them in order; fill values start from 1 and later grids overwrite earlier ones on overlap.",
  "inputs": [
    {
      "name": "grids",
      "type": "grid",
      "access": "list",
      "description": "List of single-value grids (number[][]); the order determines fill values and stacking priority.",
      "label": "网格列表"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Merged multi-value grid; grids[0] cells become 1, grids[1] become 2, etc.; later grids overwrite on overlap.",
      "label": "多值网格"
    }
  ],
  "deterministic": true
})
