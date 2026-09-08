// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionUnionAll",
  "contractVersion": "1.0.0",
  "opId": "alg_region_union_all",
  "description": "Aggregate union over a list of 0/1 grids. Output shape is the per-axis max of all grids in the list; a cell is 1 if any grid is non-zero there, otherwise 0. Out-of-bounds cells are treated as 0. Returns empty for an empty or fully invalid list.",
  "inputs": [
    {
      "name": "regions",
      "type": "grid",
      "access": "list",
      "required": true,
      "description": "A list of 0/1 grids; merged cell-wise into a normalized 0/1 union. Grids may differ in size; out-of-bounds cells are treated as 0.",
      "label": "区域列表"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "description": "Aggregate union of the list; shape is per-axis max, normalized to 0/1.",
      "label": "并集"
    }
  ],
  "deterministic": true
})
