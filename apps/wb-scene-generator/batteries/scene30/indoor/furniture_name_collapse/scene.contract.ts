// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureNameCollapse",
  "contractVersion": "1.0.0",
  "opId": "furniture_name_collapse",
  "description": "Collapses per-room furniture index and mask grid by name: merges all pixel values of same-name furniture into one new id, outputs remapped grid and deduplicated name list.",
  "inputs": [
    {
      "name": "list",
      "type": "array",
      "description": "Furniture index list with rank and name fields, from per_room or adaptive_room placer furnitureIndex output.",
      "label": "家具索引"
    },
    {
      "name": "maskA",
      "type": "grid",
      "description": "Furniture mask grid where pixel values equal rank, from placer newMaskA output.",
      "label": "家具实体网格"
    },
    {
      "name": "type",
      "type": "string",
      "defaultValue": "asset",
      "description": "The type field value for output name list entries.",
      "label": "图层类型",
      "options": [
        "asset",
        "tile"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Remapped furniture grid with consecutive ids starting from 1, aligned with nameList.",
      "label": "折叠后家具网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Deduplicated name list [{id, name, type}] with consecutive ids starting from 1.",
      "label": "名称清单"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Number of unique furniture names after deduplication.",
      "label": "唯一家具种数"
    }
  ],
  "deterministic": true
})
