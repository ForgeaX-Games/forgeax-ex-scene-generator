// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "connectedComponents",
  "contractVersion": "1.0.0",
  "opId": "connected_components",
  "description": "Label connected components of non-zero regions in a grid, assigning each a unique ID.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input 2D grid; non-zero cells are treated as foreground.",
      "label": "输入网格"
    },
    {
      "name": "connectivity",
      "type": "string",
      "defaultValue": "4",
      "description": "Connectivity mode: 4-connected (cardinal) or 8-connected (with diagonals).",
      "label": "连通方式",
      "options": [
        "4",
        "8"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Labeled grid: each connected component gets a unique positive integer ID; background is 0.",
      "label": "标记网格"
    },
    {
      "name": "numComponents",
      "type": "number",
      "description": "Total number of connected components found.",
      "label": "分量数量"
    }
  ],
  "deterministic": true
})
