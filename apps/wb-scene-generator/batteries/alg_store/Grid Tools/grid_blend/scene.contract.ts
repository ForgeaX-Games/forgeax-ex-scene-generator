// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridBlend",
  "contractVersion": "1.0.0",
  "opId": "grid_blend",
  "description": "Linearly interpolates two same-sized grids by a blend factor and outputs the blended grid.",
  "inputs": [
    {
      "name": "gridA",
      "type": "grid",
      "description": "First input grid.",
      "label": "网格 A"
    },
    {
      "name": "gridB",
      "type": "grid",
      "description": "Second input grid (must be the same size as grid A).",
      "label": "网格 B"
    },
    {
      "name": "factor",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Blend factor: 0 = grid A only, 1 = grid B only, 0.5 = equal mix.",
      "label": "混合系数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Blended output grid: each cell = A*(1-factor) + B*factor.",
      "label": "混合网格"
    }
  ],
  "deterministic": true
})
