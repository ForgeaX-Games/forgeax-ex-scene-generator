// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureListToNamelist",
  "contractVersion": "1.0.0",
  "opId": "furniture_list_to_namelist",
  "description": "Converts a furniture list (rank/name/isGroup format) to a renderer name list (id/name/type format).",
  "inputs": [
    {
      "name": "list",
      "type": "array",
      "description": "Furniture list, each item has rank, name, isGroup fields.",
      "label": "家具清单"
    },
    {
      "name": "type",
      "type": "string",
      "defaultValue": "asset",
      "description": "Type value for the output name list: asset or tile.",
      "label": "类型",
      "options": [
        "asset",
        "tile"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "nameList",
      "type": "array",
      "description": "Renderer standard name list, each item has id, name, type fields.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
