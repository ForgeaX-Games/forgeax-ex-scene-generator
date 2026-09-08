// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionComponents",
  "contractVersion": "1.0.0",
  "opId": "alg_region_components",
  "description": "Splits a region into 4-connected components; each component is emitted as its own 0/1 grid.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "required": true,
      "description": "0/1 region grid.",
      "label": "输入区域"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per 4-connected component; list ordered by BFS discovery.",
      "label": "分量列表"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Number of components.",
      "label": "分量数"
    }
  ],
  "deterministic": true
})
