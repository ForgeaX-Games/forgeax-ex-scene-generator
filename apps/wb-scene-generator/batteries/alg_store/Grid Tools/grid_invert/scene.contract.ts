// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridInvert",
  "contractVersion": "1.0.0",
  "opId": "grid_invert",
  "description": "Invert a binary grid: swap 0s and 1s.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input binary grid (values 0 or 1) to invert.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Inverted binary grid: 0→1, 1→0.",
      "label": "取反网格"
    }
  ],
  "deterministic": true
})
