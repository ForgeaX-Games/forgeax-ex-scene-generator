// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureRankSplit",
  "contractVersion": "1.0.0",
  "opId": "furniture_rank_split",
  "description": "Splits a furniture array into a main list (rank 1-7) and a fill list (rank 8-9), resetting fill ranks to 1 and 2.",
  "inputs": [
    {
      "name": "list",
      "type": "array",
      "description": "Array of furniture objects, each containing a rank field.",
      "label": "家具清单"
    }
  ],
  "outputs": [
    {
      "name": "main_list",
      "type": "array",
      "description": "Array of furniture objects with rank 1-7, rank preserved.",
      "label": "主家具清单"
    },
    {
      "name": "fill_list",
      "type": "array",
      "description": "Array of furniture objects with rank 8-9, rank reset to 1 and 2.",
      "label": "填充家具清单"
    }
  ],
  "deterministic": true
})
