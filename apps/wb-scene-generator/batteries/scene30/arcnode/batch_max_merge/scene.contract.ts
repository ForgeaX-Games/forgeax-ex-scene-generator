// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "batchMaxMerge",
  "contractVersion": "1.0.0",
  "opId": "batch_max_merge",
  "description": "Merges two grid lists element-by-element: for each index, all grids from both lists at that position are max-merged into a single grid.",
  "inputs": [
    {
      "name": "gridListA",
      "type": "any",
      "description": "First grid list; each element can be a single grid or a nested grid list at any depth.",
      "label": "网格列表A"
    },
    {
      "name": "gridListB",
      "type": "any",
      "description": "Second grid list; each element can be a single grid or a nested grid list at any depth.",
      "label": "网格列表B"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "Element-wise merged result list; length equals the shorter of the two input lists.",
      "label": "合并结果列表"
    }
  ],
  "deterministic": true
})
