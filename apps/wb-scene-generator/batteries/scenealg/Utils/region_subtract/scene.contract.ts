// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionSubtract",
  "contractVersion": "1.0.0",
  "opId": "alg_region_subtract",
  "description": "Per-cell subtract of two same-shape grids: outputs 1 when a is non-zero and b is zero, otherwise 0. Useful for cutting sub-regions out of a region.",
  "inputs": [
    {
      "name": "a",
      "type": "grid",
      "required": true,
      "description": "The grid to be subtracted from.",
      "label": "被减区域"
    },
    {
      "name": "b",
      "type": "grid",
      "required": true,
      "description": "The grid to subtract; must share a's shape.",
      "label": "减去区域"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "description": "Subtraction result (0/1 grid) with the same shape as a.",
      "label": "差集"
    }
  ],
  "deterministic": true
})
