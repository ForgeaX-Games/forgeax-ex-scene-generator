// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridMaskAb",
  "contractVersion": "1.0.0",
  "opId": "grid_mask_ab",
  "description": "Applies grid B as a mask over grid A: outputs 0 where B is 0, otherwise retains A's original value.",
  "inputs": [
    {
      "name": "gridA",
      "type": "grid",
      "description": "Data grid to be masked; retains its values where B is non-zero.",
      "label": "数据网格 A"
    },
    {
      "name": "gridB",
      "type": "grid",
      "description": "Mask grid; 0 means blocked (output 0), non-zero means pass-through (output A's value).",
      "label": "蒙版网格 B"
    }
  ],
  "outputs": [
    {
      "name": "maskedGrid",
      "type": "grid",
      "description": "Masked grid: 0 where B is 0, A's original value elsewhere.",
      "label": "遮罩后网格"
    }
  ],
  "deterministic": true
})
