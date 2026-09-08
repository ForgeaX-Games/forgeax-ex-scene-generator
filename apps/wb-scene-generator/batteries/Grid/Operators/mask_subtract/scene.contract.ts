// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maskSubtract",
  "contractVersion": "2.0.0",
  "opId": "mask_subtract",
  "description": "Computes the difference of two grids: outputs 1 where grid1 is non-zero and grid2 is zero, and 0 elsewhere. Size policy: differing sizes are tolerated by aligning the grids at their bottom-left corners; output size matches grid1, and areas grid2 does not cover are treated as 0 (unlike Intersect (mask_intersect), which requires identical sizes and otherwise errors).",
  "inputs": [
    {
      "name": "inputGrid1",
      "type": "grid",
      "access": "item",
      "description": "The minuend grid; non-zero values are treated as valid regions.",
      "label": "网格1（被减）"
    },
    {
      "name": "inputGrid2",
      "type": "grid",
      "access": "item",
      "description": "The subtrahend grid; non-zero values indicate regions to exclude. Paired branch-by-branch with grid1 via lacing.",
      "label": "网格2（减数）"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "grid1 minus grid2; output size matches grid1.",
      "label": "差集网格"
    }
  ],
  "deterministic": true
})
