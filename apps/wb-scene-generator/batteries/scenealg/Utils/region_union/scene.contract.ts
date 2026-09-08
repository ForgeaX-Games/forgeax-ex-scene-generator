// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionUnion",
  "contractVersion": "1.0.0",
  "opId": "alg_region_union",
  "description": "Per-cell union of two 0/1 grids. Output shape is the per-axis max of both inputs; for each cell, a's non-zero value wins, otherwise b's value is used. Out-of-bounds cells are treated as 0.",
  "inputs": [
    {
      "name": "a",
      "type": "grid",
      "required": true,
      "description": "Primary region; its non-zero values take precedence.",
      "label": "主区域"
    },
    {
      "name": "b",
      "type": "grid",
      "required": true,
      "description": "Secondary region; only fills cells where a is zero. Shapes may differ.",
      "label": "次区域"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "description": "Union of the two regions; shape is per-axis max.",
      "label": "并集"
    }
  ],
  "deterministic": true
})
