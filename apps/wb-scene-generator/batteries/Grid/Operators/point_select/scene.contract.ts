// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "pointSelect",
  "contractVersion": "1.1.0",
  "opId": "point_select",
  "description": "Precisely extracts points at specified coordinates from the source grid; the output retains only those points' mask values, with all other cells set to 0.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "Source grid providing mask values at each coordinate.",
      "label": "输入网格"
    },
    {
      "name": "points",
      "type": "array",
      "description": "List of coordinates. Supports nested arrays [[row,col],...], string items [\"row,col\",...], or parenthesized strings [\"(row,col)\",...]. ",
      "label": "点列表"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Same size as input grid; only the specified coordinates retain their original mask values, all others are 0.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
