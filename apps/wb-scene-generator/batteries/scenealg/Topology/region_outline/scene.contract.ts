// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionOutline",
  "contractVersion": "1.0.0",
  "opId": "alg_region_outline",
  "description": "Extracts an inward outline of given thickness from a 0/1 region. The first layer uses 8-connectivity to find the outermost border cells; subsequent layers expand inward using 4-connectivity.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "required": true,
      "description": "0/1 region grid.",
      "label": "输入区域"
    },
    {
      "name": "thickness",
      "type": "number",
      "defaultValue": 1,
      "description": "Outline thickness (inward layers), >=1.",
      "label": "厚度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "topology",
      "type": "grid",
      "description": "0/1 topology grid containing the inward outline of given thickness.",
      "label": "轮廓拓扑"
    }
  ],
  "deterministic": true
})
