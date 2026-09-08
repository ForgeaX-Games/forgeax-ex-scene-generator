// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maskIntersect",
  "contractVersion": "2.0.0",
  "opId": "mask_intersect",
  "description": "Computes the intersection of two same-size grids: outputs 1 where both grids have non-zero values, and 0 elsewhere. Size policy: the two grids MUST have identical dimensions, otherwise an error is returned (unlike Subtract (mask_subtract), which tolerates differing sizes by aligning to the bottom-left corner).",
  "inputs": [
    {
      "name": "inputGrid1",
      "type": "grid",
      "access": "item",
      "description": "First input grid; non-zero values are treated as valid regions.",
      "label": "网格1"
    },
    {
      "name": "inputGrid2",
      "type": "grid",
      "access": "item",
      "description": "Second input grid; non-zero values are treated as valid regions. Paired branch-by-branch with grid1 via lacing.",
      "label": "网格2"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Intersection of the two grids: 1 where both are non-zero, 0 otherwise.",
      "label": "交集网格"
    }
  ],
  "deterministic": true
})
